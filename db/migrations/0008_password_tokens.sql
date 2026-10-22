-- Links de uso único enviados por e-mail: redefinir senha e aceitar convite.
-- Guardamos só o hash do token; o link vale uma vez e por tempo limitado.

CREATE TABLE controle_vendas_estoque.password_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  purpose       text NOT NULL CHECK (purpose IN ('reset', 'invite')),
  token_hash    bytea NOT NULL UNIQUE,
  organization_id uuid REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_tokens_user_idx ON controle_vendas_estoque.password_tokens (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.password_tokens TO controle_vendas_estoque_app;
