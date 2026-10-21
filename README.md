# Netz ERP

ERP multiempresa de vendas, estoque e financeiro, operado pelo painel web e por um assistente de IA no Telegram. O painel e o assistente são duas formas de operar a mesma plataforma: usam os mesmos serviços, as mesmas permissões e a mesma auditoria.

- Arquitetura e decisões: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)
- Fases, estado atual e pendências: [docs/FASES.md](docs/FASES.md)

## Estrutura

| Diretório | Conteúdo |
| --- | --- |
| `db/migrations/` | Migrations SQL numeradas (imutáveis depois de aplicadas) |
| `packages/db/` | Pool, transações, contexto de RLS e runner de migrations |
| `packages/core/` | Domínio: serviços, permissões, auditoria, idempotência, outbox, jobs, autenticação e módulos |
| `apps/web/` | Painel Next.js |
| `apps/worker/` | Processo permanente que entrega eventos e executa jobs agendados |

## Rodando localmente

Requisitos: Node 22, pnpm 10 e PostgreSQL 16 (ou Docker).

```bash
docker compose up -d          # PostgreSQL com os papéis erp_owner e erp_app_login
cp .env.example .env
pnpm install
pnpm db:migrate               # usa MIGRATION_DATABASE_URL
cp .env apps/web/.env.local
pnpm dev:web                  # http://localhost:3000 abre a configuração inicial
pnpm dev:worker               # em outro terminal
```

A primeira visita abre `/setup`, que cria a empresa e o proprietário. Essa tela deixa de existir assim que houver um usuário.

## Testes

```bash
pnpm test        # testes do núcleo contra PostgreSQL real (banco erp_test)
pnpm typecheck
```

Os testes recriam o schema `erp` do banco de teste. Nunca aponte `TEST_*_DATABASE_URL` para um banco com dados.

## Papéis do banco

- **Dono das tabelas** (`MIGRATION_DATABASE_URL`): aplica migrations e sincroniza o catálogo de permissões. Não é usado pela aplicação.
- **`erp_app`**: papel da aplicação, sujeito a Row Level Security. A conta de login da web e do worker deve ser membro dele (`CREATE ROLE ... LOGIN IN ROLE erp_app`).

Com isso, mesmo um erro de código que esqueça um filtro por empresa não consegue ler nem gravar dados de outra empresa.
