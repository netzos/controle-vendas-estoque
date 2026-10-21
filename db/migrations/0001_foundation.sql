-- Fase 1: Fundação.
-- Organizações, filiais, usuários, sessões, papéis, permissões, vínculos,
-- configurações, auditoria, idempotência, outbox e jobs agendados.
--
-- Papéis do banco:
--   dono das tabelas  quem roda as migrations; não é usado pela aplicação.
--   controle_vendas_estoque_app           papel da aplicação (web e worker). Sujeito a RLS.
-- A conta de login da aplicação deve ser membro de controle_vendas_estoque_app, por exemplo:
--   CREATE ROLE controle_vendas_estoque_app_login LOGIN PASSWORD '...' IN ROLE controle_vendas_estoque_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'controle_vendas_estoque_app') THEN
    CREATE ROLE controle_vendas_estoque_app NOLOGIN;
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS controle_vendas_estoque;
GRANT USAGE ON SCHEMA controle_vendas_estoque TO controle_vendas_estoque_app;

-- Contexto da transação, fixado pela aplicação com set_config(..., true).
CREATE FUNCTION controle_vendas_estoque.current_org() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.organization_id', true), '')::uuid
$$;

CREATE FUNCTION controle_vendas_estoque.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE FUNCTION controle_vendas_estoque.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Organizações -------------------------------------------------------------

CREATE TABLE controle_vendas_estoque.organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  legal_name    text,
  document      text,
  timezone      text NOT NULL DEFAULT 'America/Sao_Paulo',
  currency      char(3) NOT NULL DEFAULT 'BRL',
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER organizations_touch BEFORE UPDATE ON controle_vendas_estoque.organizations
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

CREATE TABLE controle_vendas_estoque.branches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,20}$'),
  document          text,
  is_headquarters   boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX branches_one_headquarters
  ON controle_vendas_estoque.branches (organization_id) WHERE is_headquarters;
CREATE TRIGGER branches_touch BEFORE UPDATE ON controle_vendas_estoque.branches
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

-- Usuários e sessões (globais: um usuário pode pertencer a várias organizações).
-- Acessados apenas pelo módulo de autenticação.

CREATE TABLE controle_vendas_estoque.users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL CHECK (email = lower(email) AND email LIKE '%_@_%'),
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  password_hash   text,
  must_change_password boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON controle_vendas_estoque.users (email);
CREATE TRIGGER users_touch BEFORE UPDATE ON controle_vendas_estoque.users
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

CREATE TABLE controle_vendas_estoque.sessions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  token_hash              bytea NOT NULL UNIQUE,
  active_organization_id  uuid REFERENCES controle_vendas_estoque.organizations(id) ON DELETE SET NULL,
  ip                      inet,
  user_agent              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  last_seen_at            timestamptz NOT NULL DEFAULT now(),
  expires_at              timestamptz NOT NULL,
  revoked_at              timestamptz
);
CREATE INDEX sessions_user_idx ON controle_vendas_estoque.sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON controle_vendas_estoque.sessions (expires_at);

CREATE TABLE controle_vendas_estoque.login_attempts (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL,
  ip            inet,
  succeeded     boolean NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON controle_vendas_estoque.login_attempts (email, attempted_at DESC);

-- Permissões e papéis -------------------------------------------------------

-- Catálogo global, sincronizado a partir do código (packages/core/src/permissions.ts).
CREATE TABLE controle_vendas_estoque.permissions (
  key           text PRIMARY KEY CHECK (key ~ '^[a-z_]+\.[a-z_]+$'),
  module        text NOT NULL,
  description   text NOT NULL,
  risk_level    smallint NOT NULL CHECK (risk_level BETWEEN 1 AND 4)
);

CREATE TABLE controle_vendas_estoque.roles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  key               text NOT NULL CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  name              text NOT NULL,
  description       text,
  is_system         boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key),
  UNIQUE (organization_id, id)
);
CREATE TRIGGER roles_touch BEFORE UPDATE ON controle_vendas_estoque.roles
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

CREATE TABLE controle_vendas_estoque.role_permissions (
  organization_id   uuid NOT NULL,
  role_id           uuid NOT NULL,
  permission_key    text NOT NULL REFERENCES controle_vendas_estoque.permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key),
  FOREIGN KEY (organization_id, role_id) REFERENCES controle_vendas_estoque.roles (organization_id, id) ON DELETE CASCADE
);

CREATE TABLE controle_vendas_estoque.memberships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  role_id           uuid NOT NULL,
  is_owner          boolean NOT NULL DEFAULT false,
  -- NULL = todas as filiais.
  branch_ids        uuid[],
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id),
  FOREIGN KEY (organization_id, role_id) REFERENCES controle_vendas_estoque.roles (organization_id, id)
);
CREATE INDEX memberships_user_idx ON controle_vendas_estoque.memberships (user_id);
CREATE TRIGGER memberships_touch BEFORE UPDATE ON controle_vendas_estoque.memberships
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

-- Configurações por organização (chave/valor validado pela aplicação).

CREATE TABLE controle_vendas_estoque.organization_settings (
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  key               text NOT NULL,
  value             jsonb NOT NULL,
  updated_by        uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, key)
);

-- Auditoria (somente inserção e leitura para a aplicação).

CREATE TABLE controle_vendas_estoque.audit_logs (
  id                bigserial PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  actor_user_id     uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  channel           text NOT NULL CHECK (channel IN ('web', 'telegram', 'api', 'system', 'whatsapp')),
  action            text NOT NULL,
  entity_type       text,
  entity_id         text,
  summary           text,
  before_data       jsonb,
  after_data        jsonb,
  metadata          jsonb NOT NULL DEFAULT '{}',
  request_id        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_time_idx ON controle_vendas_estoque.audit_logs (organization_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON controle_vendas_estoque.audit_logs (organization_id, entity_type, entity_id);

-- Idempotência de operações ------------------------------------------------

CREATE TABLE controle_vendas_estoque.idempotency_keys (
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  scope             text NOT NULL,
  key               text NOT NULL,
  request_hash      text NOT NULL,
  response          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT now() + interval '30 days',
  PRIMARY KEY (organization_id, scope, key)
);
CREATE INDEX idempotency_keys_expiry_idx ON controle_vendas_estoque.idempotency_keys (expires_at);

-- Outbox transacional -------------------------------------------------------

CREATE TABLE controle_vendas_estoque.outbox_events (
  id                bigserial PRIMARY KEY,
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  event_type        text NOT NULL CHECK (event_type ~ '^[a-z_]+\.[a-z_.]+$'),
  aggregate_type    text,
  aggregate_id      text,
  payload           jsonb NOT NULL DEFAULT '{}',
  actor_user_id     uuid,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'done', 'dead')),
  attempts          integer NOT NULL DEFAULT 0,
  available_at      timestamptz NOT NULL DEFAULT now(),
  locked_until      timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz
);
CREATE INDEX outbox_events_ready_idx ON controle_vendas_estoque.outbox_events (available_at, id)
  WHERE status IN ('pending', 'processing');

CREATE TABLE controle_vendas_estoque.outbox_consumptions (
  event_id          bigint NOT NULL REFERENCES controle_vendas_estoque.outbox_events(id) ON DELETE CASCADE,
  consumer          text NOT NULL,
  organization_id   uuid NOT NULL,
  processed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer)
);

-- Jobs agendados (fila genérica do sistema) ---------------------------------

CREATE TABLE controle_vendas_estoque.scheduled_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL para jobs de sistema (ex.: limpeza), que não acessam dados de organização.
  organization_id   uuid REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  job_type          text NOT NULL CHECK (job_type ~ '^[a-z_]+\.[a-z_.]+$'),
  payload           jsonb NOT NULL DEFAULT '{}',
  scheduled_for     timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'dead', 'cancelled')),
  attempts          integer NOT NULL DEFAULT 0,
  max_attempts      integer NOT NULL DEFAULT 8 CHECK (max_attempts BETWEEN 1 AND 50),
  idempotency_key   text,
  locked_by         text,
  locked_until      timestamptz,
  last_error        text,
  result            jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  finished_at       timestamptz
);
CREATE UNIQUE INDEX scheduled_jobs_idempotency_key
  ON controle_vendas_estoque.scheduled_jobs (job_type, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX scheduled_jobs_ready_idx ON controle_vendas_estoque.scheduled_jobs (scheduled_for)
  WHERE status IN ('pending', 'failed', 'running');
CREATE INDEX scheduled_jobs_org_idx ON controle_vendas_estoque.scheduled_jobs (organization_id, created_at DESC);

-- Row Level Security --------------------------------------------------------

ALTER TABLE controle_vendas_estoque.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.outbox_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.scheduled_jobs ENABLE ROW LEVEL SECURITY;

-- O usuário vê as próprias filiações (para escolher a organização) e todas as
-- filiações da organização ativa.
CREATE POLICY memberships_access ON controle_vendas_estoque.memberships
  USING (organization_id = controle_vendas_estoque.current_org() OR user_id = controle_vendas_estoque.current_user_id())
  WITH CHECK (organization_id = controle_vendas_estoque.current_org());

CREATE POLICY organizations_access ON controle_vendas_estoque.organizations
  USING (
    id = controle_vendas_estoque.current_org()
    OR EXISTS (
      SELECT 1 FROM controle_vendas_estoque.memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = controle_vendas_estoque.current_user_id()
        AND m.status = 'active'
    )
  )
  WITH CHECK (id = controle_vendas_estoque.current_org());

CREATE POLICY branches_tenant ON controle_vendas_estoque.branches
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY roles_tenant ON controle_vendas_estoque.roles
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
-- Permite ao usuário ver o nome do próprio perfil ao escolher a empresa.
CREATE POLICY roles_own_membership ON controle_vendas_estoque.roles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM controle_vendas_estoque.memberships m
    WHERE m.role_id = roles.id AND m.user_id = controle_vendas_estoque.current_user_id()
  ));
CREATE POLICY role_permissions_tenant ON controle_vendas_estoque.role_permissions
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY settings_tenant ON controle_vendas_estoque.organization_settings
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY audit_tenant ON controle_vendas_estoque.audit_logs
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY idempotency_tenant ON controle_vendas_estoque.idempotency_keys
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY outbox_tenant ON controle_vendas_estoque.outbox_events
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY outbox_consumptions_tenant ON controle_vendas_estoque.outbox_consumptions
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
-- Jobs de sistema (organization_id NULL) só são vistos sem organização ativa.
CREATE POLICY scheduled_jobs_tenant ON controle_vendas_estoque.scheduled_jobs
  USING (organization_id IS NOT DISTINCT FROM controle_vendas_estoque.current_org())
  WITH CHECK (organization_id IS NOT DISTINCT FROM controle_vendas_estoque.current_org());

-- Reivindicação de trabalho pelo worker -------------------------------------
-- O worker precisa enxergar filas de todas as organizações para reivindicá-las.
-- Estas funções rodam com o dono das tabelas (SECURITY DEFINER), devolvem só
-- identificadores e o processamento segue em transação com o RLS da organização.

CREATE FUNCTION controle_vendas_estoque.claim_outbox_events(p_limit integer, p_lock_seconds integer)
RETURNS TABLE (id bigint, organization_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  UPDATE controle_vendas_estoque.outbox_events e
     SET status = 'processing',
         attempts = e.attempts + 1,
         locked_until = now() + make_interval(secs => p_lock_seconds)
   WHERE e.id IN (
     SELECT c.id FROM controle_vendas_estoque.outbox_events c
      WHERE (c.status = 'pending' AND c.available_at <= now())
         OR (c.status = 'processing' AND c.locked_until < now())
      ORDER BY c.id
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING e.id, e.organization_id
$$;

CREATE FUNCTION controle_vendas_estoque.claim_scheduled_jobs(p_worker text, p_limit integer, p_lock_seconds integer)
RETURNS TABLE (id uuid, organization_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  UPDATE controle_vendas_estoque.scheduled_jobs j
     SET status = 'running',
         attempts = j.attempts + 1,
         locked_by = p_worker,
         locked_until = now() + make_interval(secs => p_lock_seconds),
         started_at = now()
   WHERE j.id IN (
     SELECT c.id FROM controle_vendas_estoque.scheduled_jobs c
      WHERE (c.status IN ('pending', 'failed') AND c.scheduled_for <= now())
         OR (c.status = 'running' AND c.locked_until < now())
      ORDER BY c.scheduled_for
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING j.id, j.organization_id
$$;

-- Limpeza de dados expirados (sessões, chaves de idempotência, tentativas de login).
CREATE FUNCTION controle_vendas_estoque.purge_expired() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
DECLARE
  v_sessions integer;
  v_keys integer;
  v_attempts integer;
BEGIN
  DELETE FROM controle_vendas_estoque.sessions WHERE expires_at < now() - interval '7 days'
                              OR revoked_at < now() - interval '7 days';
  GET DIAGNOSTICS v_sessions = ROW_COUNT;
  DELETE FROM controle_vendas_estoque.idempotency_keys WHERE expires_at < now();
  GET DIAGNOSTICS v_keys = ROW_COUNT;
  DELETE FROM controle_vendas_estoque.login_attempts WHERE attempted_at < now() - interval '30 days';
  GET DIAGNOSTICS v_attempts = ROW_COUNT;
  RETURN jsonb_build_object('sessions', v_sessions, 'idempotency_keys', v_keys, 'login_attempts', v_attempts);
END $$;

REVOKE ALL ON FUNCTION controle_vendas_estoque.claim_outbox_events(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION controle_vendas_estoque.claim_scheduled_jobs(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION controle_vendas_estoque.purge_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.claim_outbox_events(integer, integer) TO controle_vendas_estoque_app;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.claim_scheduled_jobs(text, integer, integer) TO controle_vendas_estoque_app;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.purge_expired() TO controle_vendas_estoque_app;

-- Privilégios da aplicação --------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON
  controle_vendas_estoque.organizations, controle_vendas_estoque.branches, controle_vendas_estoque.users, controle_vendas_estoque.sessions, controle_vendas_estoque.roles,
  controle_vendas_estoque.memberships, controle_vendas_estoque.organization_settings, controle_vendas_estoque.idempotency_keys,
  controle_vendas_estoque.outbox_events, controle_vendas_estoque.scheduled_jobs
TO controle_vendas_estoque_app;
GRANT SELECT, INSERT, DELETE ON controle_vendas_estoque.role_permissions TO controle_vendas_estoque_app;
GRANT DELETE ON controle_vendas_estoque.roles TO controle_vendas_estoque_app;
GRANT SELECT, INSERT ON controle_vendas_estoque.login_attempts, controle_vendas_estoque.outbox_consumptions, controle_vendas_estoque.audit_logs TO controle_vendas_estoque_app;
GRANT SELECT ON controle_vendas_estoque.permissions TO controle_vendas_estoque_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA controle_vendas_estoque TO controle_vendas_estoque_app;
