# Fases do desenvolvimento

Plano da seção 26 da especificação. Cada fase só é marcada como concluída quando funciona de ponta a ponta, com testes.

| Fase | Escopo | Estado |
| --- | --- | --- |
| 1 | Fundação | Concluída |
| 2 | Cadastros | Próxima |
| 3 | Vendas | — |
| 4 | Telegram e IA operacional básica | — |
| 5 | Estoque e compras | — |
| 6 | Financeiro | — |
| 7 | Automações e alertas | — |
| 8 | Inteligência analítica | — |
| 9 | IA avançada | — |
| 10 | Escalabilidade e integrações | — |

## Fase 1: Fundação

### Entregue

- **Estrutura**: monorepo pnpm com `packages/db`, `packages/core`, `apps/web` e `apps/worker`; CI com PostgreSQL.
- **Banco e migrations**: `0001_foundation.sql` com organizações, filiais, usuários, sessões, perfis, permissões, vínculos, configurações, auditoria, idempotência, outbox e jobs agendados. Runner com checksum (migration alterada depois de aplicada é recusada) e trava contra execução simultânea.
- **Isolamento multiempresa**: RLS em todas as tabelas com `organization_id`; a aplicação conecta com papel sem privilégio de dono; o contexto é fixado por transação.
- **Autenticação**: senha com scrypt, sessão em cookie HttpOnly com token guardado só como hash, expiração deslizante de 12 h, bloqueio após 5 falhas em 15 min, troca obrigatória de senha provisória, troca de senha encerra outras sessões, configuração inicial que só existe com o banco vazio.
- **Permissões**: catálogo no código sincronizado com o banco; seis perfis padrão por empresa; perfis personalizados; ninguém concede permissão que não tem; só proprietário concede o perfil Proprietário; empresa nunca fica sem proprietário ativo; ninguém altera o próprio acesso; desativar acesso encerra as sessões.
- **Infraestrutura de serviços**: `defineService`/`runService` com permissão, validação, transação, idempotência, auditoria e eventos na mesma transação. É a base das ferramentas da IA na Fase 4.
- **Infraestrutura de eventos**: outbox transacional com NOTIFY, consumidores idempotentes, backoff e estado `dead`; fila de jobs com chave de idempotência, reivindicação com SKIP LOCKED, recuperação de worker morto, falha permanente e limpeza horária de dados expirados.
- **Painel**: login, configuração inicial, layout com sidebar da seção 25 (módulos futuros aparecem desabilitados com a fase), troca de empresa, Empresa, Filiais, Usuários, Permissões, Auditoria e Configurações gerais. Responsivo.

### Verificado

- 26 testes automatizados do núcleo contra PostgreSQL 16, incluindo os cenários G (duplicidade), H (sem permissão) e I (múltiplas empresas) da seção 27.
- Fluxo completo no navegador: configuração inicial, cadastro de filial, cadastro de usuário, edição de perfil, auditoria, troca obrigatória de senha, menu e bloqueio de páginas conforme o perfil, layout em 390 px sem rolagem horizontal.

### Pendências e decisões em aberto

- **Parte 1 da especificação** (seções 1 a 8) ainda não recebida. Pode ajustar as Fases 2 a 6.
- **Recuperação de senha por e-mail**: depende de um provedor de e-mail. Hoje o administrador redefine o acesso.
- **Criação de empresas adicionais pelo painel**: a função existe (`createOrganization`) e é testada, mas ainda não há tela; definir quem pode criar.
- **Autenticação adicional** para operações críticas (nível 4): entra junto com as confirmações da Fase 4.
- **Hospedagem**: o worker exige processo permanente. Definir o servidor antes da Fase 4.
- **Retenção da auditoria**: hoje é permanente; definir política quando houver volume.
