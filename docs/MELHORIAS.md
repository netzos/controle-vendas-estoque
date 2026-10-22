# Melhorias do ERP

A tela **Melhorias** (menu Colaboração) é o quadro onde quem usa o ERP pede mudanças no sistema, conversa sobre cada pedido e acompanha tudo até a publicação. Segue o mesmo fluxo do NetzOS e do IONPA.

## Fluxo

1. **Pedido.** Pode ser registrado de três formas:
   - no painel, por qualquer pessoa da empresa;
   - pela IA do sistema (a partir da Fase 8), ao ouvir uma sugestão ou perceber algo que o sistema ainda não faz. A função `agentCreateImprovement` guarda as partes do pedido: a fala original, o problema (o porquê), a proposta reescrita e como saber que ficou pronto. Um pedido aberto com o mesmo título recebe uma mensagem em vez de virar outro pedido, e há limite de 20 por pessoa por dia;
   - pelo Claude.
2. **Análise.** O Claude confere os pedidos novos. Em cada um, escreve na conversa o que mudaria, como faria, o risco, o esforço e as dúvidas, e move o pedido para **Em análise**.
3. **Correção e decisão.** Enquanto o pedido não entrou em desenvolvimento (novo, em análise ou aprovado), quem pediu ou o desenvolvedor corrige o pedido (botão **Corrigir pedido**). Pela Netz, a pessoa complementa um pedido pelo número (`complementar_melhoria`); o complemento entra na conversa com data e autor. A correção fica registrada na conversa ("Pedido corrigido: título, proposta."), para o Claude rever a análise. **Só o desenvolvedor aprova ou recusa.**
4. **Publicação.** Com o pedido aprovado, o Claude:
   - marca **Em desenvolvimento**;
   - implementa numa branch, abre o PR e publica;
   - marca **Publicado** com o link `https://` da mudança;
   - explica na conversa o que mudou e como usar.

   Nada é construído sem aprovação.

**Status:** novo, em análise, aprovado, em desenvolvimento, publicado, recusado.

**Origem:** painel, Telegram, percebido pela IA do sistema, sugerido pelo Claude.

**Módulos:** geral, comercial, catálogo, estoque, compras, financeiro, inteligência, assistente IA, automações, administração.

## Quem vê o quê

- Cada empresa vê só os próprios pedidos (garantido pelo RLS do banco).
- O **desenvolvedor da plataforma** vê os pedidos de todas as empresas, com o nome da empresa, e é o único que aprova ou recusa. Esse papel não vem de perfil de acesso da empresa: fica na tabela `controle_vendas_estoque.platform_developers`, que a aplicação não consegue alterar. Para incluir ou remover, com a conexão de dono do banco:

  ```sh
  MIGRATION_DATABASE_URL=... pnpm platform:developer add acesso@netzcode.com.br
  MIGRATION_DATABASE_URL=... pnpm platform:developer remove alguem@exemplo.com
  ```

- O Claude vê todos os pedidos, comenta e move o status, mas não aprova nem recusa.
- Pedidos e mensagens não devem conter dados pessoais de clientes.

## Lado do Claude

Rota HTTPS, protegida por `CLAUDE_IMPROVEMENTS_TOKEN` (mínimo de 32 caracteres; sem ele a rota fica fechada):

```sh
curl -H "Authorization: Bearer $TOKEN" "$URL/api/claude/improvements?status=new"
curl -H "Authorization: Bearer $TOKEN" "$URL/api/claude/improvements/<id>"
curl -H "Authorization: Bearer $TOKEN" -d '{"body":"Análise: ..."}' "$URL/api/claude/improvements/<id>/messages"
curl -H "Authorization: Bearer $TOKEN" -d '{"status":"analysis","body":"Análise: ..."}' "$URL/api/claude/improvements/<id>/status"
curl -H "Authorization: Bearer $TOKEN" -d '{"status":"published","link":"https://github.com/netzos/netz-erp/pull/<n>","body":"O que mudou e como usar."}' "$URL/api/claude/improvements/<id>/status"
curl -H "Authorization: Bearer $TOKEN" -d '{"module":"geral","title":"...","body":"..."}' "$URL/api/claude/improvements"
```

Com acesso direto ao banco (`DATABASE_URL` da aplicação), o comando faz o mesmo:

```sh
pnpm improvements list new
pnpm improvements show <id>
echo "Análise: ..." | pnpm improvements comment <id>
echo "Análise: ..." | pnpm improvements status <id> analysis
echo "Começando."   | pnpm improvements status <id> building
echo "O que mudou e como usar." | pnpm improvements status <id> published https://github.com/netzos/netz-erp/pull/<n>
echo "Descrição"    | pnpm improvements create <modulo> <título>
```

Mudanças de status que o Claude pode fazer:

| De | Para |
| --- | --- |
| novo | em análise |
| aprovado | em desenvolvimento |
| em desenvolvimento | publicado (exige link `https://`) |

## Conferência de hora em hora (roteiro do Claude)

1. Liste os pedidos `new`. Para cada um, leia o pedido e a conversa, escreva a análise e mova para `analysis` com a análise no corpo.
2. Releia os pedidos `analysis` que receberam correção depois da sua análise e atualize a análise.
3. Liste os pedidos `approved`. Para cada um:
   1. mova para `building`;
   2. implemente numa branch `melhoria/<assunto>`, com testes, e abra o PR em netzos/netz-erp;
   3. depois do merge e da publicação, mova para `published` com o link e a explicação.

## Onde fica o código

| Peça | Arquivos |
| --- | --- |
| Banco | `db/migrations/0002_improvements.sql` |
| Regras | `packages/core/src/modules/improvements/service.ts` |
| Testes | `packages/core/test/improvements.test.ts` |
| Comando do Claude | `packages/core/src/cli-improvements.ts` |
| Rota do Claude | `apps/web/src/app/api/claude/improvements/` |
| Painel | `apps/web/src/app/(app)/melhorias/` |
