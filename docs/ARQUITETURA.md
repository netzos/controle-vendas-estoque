# Arquitetura do ERP

Este documento responde à seção 29 da especificação: estado de partida, arquitetura modular, migrations, serviços compartilhados entre web e Telegram, contratos das ferramentas da IA e estratégia de agendamento e notificações.

## 1. Ponto de partida

Nenhum repositório existente da conta contém um ERP de vendas e estoque. O ERP começa do zero, aproveitando decisões já validadas em outros projetos da Netzcode:

- **IONPA** (Next.js + Supabase): sessões em cookies HttpOnly, nada de token em `localStorage`, auditoria por operação, bot do Telegram com lembretes.
- **NetzOS** (Go + Next.js + runtime de agentes): isolamento por conta, ponte Telegram com entrega confirmada, ferramentas de agente com permissões resolvidas no backend.

O que muda aqui: o ERP precisa de transações com estoque e financeiro, filas confiáveis e um processo permanente (worker) para agendamentos. Por isso o backend não depende de funções serverless.

## 2. Stack

| Camada | Escolha | Motivo |
| --- | --- | --- |
| Linguagem | TypeScript em todo o monorepo | Um único conjunto de tipos para serviços, ferramentas da IA e telas |
| Painel web | Next.js (App Router, Server Actions) | Renderização no servidor, sem expor regras de negócio ao navegador |
| Worker | Processo Node dedicado | Outbox, jobs agendados, lembretes e envio ao Telegram sem depender de requisição aberta |
| Banco | PostgreSQL 16 | Transações, `FOR UPDATE SKIP LOCKED` para filas, Row Level Security para isolamento |
| Acesso a dados | `pg` com SQL explícito | Controle total sobre bloqueios, transações e RLS |
| Validação | `zod` | Mesmo schema valida formulário web, API e parâmetros de ferramenta da IA |
| Migrations | Arquivos SQL numerados + runner próprio com checksum | Revisáveis, sem geração automática escondida |
| Testes | `node:test` contra PostgreSQL real | As regras críticas são testadas no banco, não em mocks |

## 3. Estrutura do monorepo

```
netz-erp/
  db/migrations/          SQL numerado, aplicado em ordem
  packages/
    db/                   pool, transações, contexto RLS, runner de migrations
    core/                 domínio: contexto do ator, permissões, serviços, auditoria,
                          idempotência, outbox, jobs, módulos de negócio
  apps/
    web/                  painel Next.js (usa apenas packages/core)
    worker/               despachante de outbox e executor de jobs (usa packages/core)
  docs/                   arquitetura, fases, pendências
```

Os módulos de negócio vivem em `packages/core/src/modules/<módulo>`. A partir da Fase 4 entram `packages/channels` (adaptadores Telegram/WhatsApp) e `packages/ai` (orquestrador e registro de ferramentas).

## 4. Princípio central: um serviço, vários canais

Toda operação de negócio é um **serviço** declarado uma única vez:

```ts
export const confirmSale = defineService({
  name: "sales.confirm",
  permission: "sales.confirm",
  risk: 3,                     // nível da seção 13
  input: z.object({ saleId: z.string().uuid() }),
  idempotent: true,
  async handler(ctx, input) { /* regra de negócio, dentro de transação */ },
});
```

`runService(service, actor, input, { idempotencyKey })` executa sempre a mesma sequência:

1. Resolve o ator a partir da sessão autenticada (web) ou da conexão Telegram vinculada; nunca do texto do usuário.
2. Verifica a permissão do ator na organização.
3. Valida a entrada com o schema.
4. Abre a transação e fixa `app.organization_id` e `app.user_id` para o RLS.
5. Se houver chave de idempotência, devolve o resultado gravado quando a operação já foi executada.
6. Executa o handler.
7. Grava auditoria e eventos de outbox **na mesma transação**.
8. Faz commit; se algo falhar, nada é gravado.

O painel chama o serviço por Server Action, o Telegram chama pela ferramenta da IA e um botão inline chama pelo callback. Não existe um segundo caminho de venda ou estoque para o bot (seção 23).

## 5. Isolamento multiempresa

- Toda tabela de negócio tem `organization_id NOT NULL` e chave estrangeira para `organizations`.
- A aplicação conecta com um papel sem privilégio de dono (`erp_app`). As tabelas têm **Row Level Security** com a política `organization_id = current_setting('app.organization_id')::uuid`.
- O contexto é fixado com `set_config(..., true)` dentro da transação, por isso não vaza entre conexões do pool.
- Mesmo que um serviço esqueça um filtro, o banco recusa linhas de outra organização. O teste de isolamento (Teste I da seção 27) verifica isso diretamente no banco.
- Tabelas globais (usuários, sessões) não têm `organization_id`; o vínculo é feito por `memberships`.

## 6. Permissões

- Permissões são chaves estáveis (`sales.confirm`, `products.update_price`, `users.manage`), declaradas em código e sincronizadas na tabela `permissions`.
- Papéis (`roles`) pertencem à organização. Cada organização nasce com Proprietário, Administrador, Vendedor, Financeiro, Estoquista e Consulta; o proprietário pode criar papéis próprios.
- Um usuário pode pertencer a várias organizações, com um papel em cada uma (`memberships`).
- O nível de risco de cada serviço (1 a 4) define a política de confirmação da IA. A permissão define se o usuário pode executar; o risco define como a IA pede confirmação.

## 7. Eventos e outbox

- Serviços gravam eventos em `outbox_events` na mesma transação do dado (`sale.confirmed`, `payment.registered`, `stock.below_minimum`).
- O worker lê lotes com `FOR UPDATE SKIP LOCKED`, entrega aos assinantes registrados e marca o evento como processado. Falhas voltam para a fila com backoff exponencial; depois do limite de tentativas o evento fica em `dead` para análise.
- Cada assinante grava seu progresso em `outbox_consumptions (event_id, consumer)`, então reprocessar um evento não executa duas vezes o mesmo efeito.
- Automações por evento (seção 10), atualização de dashboards e notificações são assinantes do outbox.

## 8. Agendamento e notificações

**Jobs agendados (`scheduled_jobs`).** Fila persistente no PostgreSQL com `scheduled_for`, `status`, `attempts`, `idempotency_key` única e `locked_until`. O worker reivindica jobs vencidos com `SKIP LOCKED`; um worker que morre libera o job quando `locked_until` expira. Vários workers podem rodar ao mesmo tempo.

**Regras recorrentes (Fase 7).** `automation_rules` e `scheduled_reports` guardam a configuração e `next_run_at`. Um job "planejador" roda a cada minuto, cria a execução da próxima ocorrência com chave de idempotência `regra:ocorrência` e recalcula `next_run_at` no fuso da organização. Disparo decidido por regra determinística; a IA só redige o texto.

**Lembretes de vencimento.** O planejador gera, para cada título em aberto e cada ponto da régua (−3, −1, 0, +3, +7 dias), um job com chave `titulo:ponto`. No momento do envio, o saldo é **lido de novo**; título quitado, cancelado ou estornado não gera mensagem (Teste E).

**Deduplicação de alertas.** `alert_states (organização, tipo, referência)` guarda a última assinatura do alerta (por exemplo, faixa de saldo). Um alerta só é reenviado quando a assinatura muda ou a janela de silêncio expira.

**Entrega.** `notifications` (o que deve ser comunicado) e `notification_deliveries` (cada tentativa por canal). O envio ao Telegram é um job com chave de idempotência; respeita limite de taxa por chat, faz retentativas em erros temporários (429, 5xx, rede) e só marca `delivered` com a resposta de sucesso da API. Nada é declarado enviado sem confirmação (seção 28).

## 9. Telegram e IA (Fases 4 e 9)

Fluxo: Telegram → webhook (valida `X-Telegram-Bot-Api-Secret-Token`) → grava `telegram_updates` com `update_id` único → responde 200 imediatamente → job `telegram.process_update` → adaptador converte em `IncomingMessage` → orquestrador → ferramentas → serviços → resposta enviada pelo serviço de entrega.

- **Vinculação**: o usuário gera no painel um código de uso único e curto prazo; o bot recebe `/start <código>` e cria `telegram_connections`. Mensagens de chats não vinculados recebem apenas instruções de vinculação, nunca dados.
- **Ferramentas da IA** são uma visão dos serviços: nome, descrição, schema `zod` convertido em JSON Schema e nível de risco. O modelo nunca recebe SQL nem IDs de organização.
- **Confirmações** (níveis 3 e 4) criam `ai_operation_requests` com parâmetros validados, prazo de validade e token único no botão. Executar consome o token atomicamente; botão vencido ou repetido é recusado (Testes K e G).
- **Idempotência da conversa**: a chave de cada operação deriva de `update_id` e da posição da chamada de ferramenta, então o mesmo update processado duas vezes devolve o mesmo resultado (Teste G e L).
- **Dados do banco e de arquivos são dados**: o orquestrador marca resultados de ferramentas como conteúdo não confiável no prompt.

### Contrato das ferramentas

```ts
interface ToolContract<I, O> {
  name: string;               // ex.: "create_sale_draft"
  description: string;        // texto para o modelo, em português
  service: ServiceDefinition<I, O>;
  risk: 1 | 2 | 3 | 4;        // herdado do serviço
  summarize(output: O): string; // resumo estruturado que volta ao modelo
}

type ToolResult<O> =
  | { ok: true; data: O; auditId?: string }
  | { ok: false; code: "forbidden" | "invalid_input" | "not_found" | "ambiguous"
        | "confirmation_required" | "conflict" | "unavailable"; message: string;
      candidates?: Array<{ id: string; label: string }> };
```

`ambiguous` com `candidates` cobre o caso de dois clientes chamados João (Teste J). `confirmation_required` devolve o resumo que a IA mostra antes dos botões.

## 10. Migrations planejadas

| Fase | Migration | Conteúdo |
| --- | --- | --- |
| 1 | `0001_foundation` | papéis do banco, organizações, filiais, usuários, sessões, papéis, permissões, vínculos, configurações, auditoria, idempotência, outbox, jobs agendados, RLS |
| 2 | `0002_catalog` | clientes, fornecedores, categorias, marcas, unidades, produtos, variações, serviços, tabelas de preço, definições e valores de campos personalizados |
| 3 | `0003_sales` | orçamentos, vendas, itens com custo histórico, descontos, cancelamentos, devoluções, numeração por organização |
| 4 | `0004_telegram_ai` | conexões e updates do Telegram, conversas, mensagens, estados, pedidos de operação, execuções de ferramentas, preferências |
| 5 | `0005_inventory_purchasing` | depósitos, saldos, movimentações, lotes e validades, inventários, transferências, pedidos de compra, recebimentos |
| 6 | `0006_finance` | contas a receber e a pagar, baixas parciais, despesas, formas de pagamento, fluxo de caixa |
| 7 | `0007_automation` | regras, execuções, estados de alerta, notificações, entregas, preferências, relatórios programados |
| 8 | `0008_analytics` | views e índices para dashboards, curva ABC, RFM |

A seção 22 foi refinada assim: `scheduled_jobs` é a fila genérica de todo o sistema (não só de automações), e `outbox_events` foi acrescentada para eventos transacionais.

## 11. Decisões em aberto

- Parte 1 da especificação (seções 1 a 8) ainda não foi recebida. Regras de cadastro, vendas e estoque dela podem ajustar as migrations das Fases 2 a 6.
- Hospedagem: o worker precisa de processo permanente (servidor com Docker Compose, Railway, Fly etc.). O painel pode ficar na Vercel ou no mesmo servidor.
- Provedor do modelo de IA na Fase 4.
