-- Cadastro aberto com aprovação: qualquer pessoa pede uma conta pelo site, mas
-- só usa o sistema depois que o administrador da plataforma aprova. A senha é
-- criada no pedido (guardamos só o hash) e passa para a conta na aprovação.
CREATE TABLE controle_vendas_estoque.signup_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number            bigserial UNIQUE,
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  email             text NOT NULL CHECK (email = lower(email) AND email LIKE '%_@_%'),
  whatsapp          text CHECK (whatsapp IS NULL OR length(whatsapp) <= 30),
  organization_name text NOT NULL CHECK (length(btrim(organization_name)) BETWEEN 2 AND 120),
  business          text CHECK (business IS NULL OR length(business) <= 500),
  password_hash     text NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by        uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  reject_reason     text CHECK (reject_reason IS NULL OR length(reject_reason) <= 500),
  organization_id   uuid REFERENCES controle_vendas_estoque.organizations(id) ON DELETE SET NULL,
  user_id           uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  ip                text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
-- Um pedido em análise por e-mail.
CREATE UNIQUE INDEX signup_requests_pending_email ON controle_vendas_estoque.signup_requests (email) WHERE status = 'pending';
CREATE INDEX signup_requests_status_idx ON controle_vendas_estoque.signup_requests (status, created_at DESC);
CREATE INDEX signup_requests_ip_idx ON controle_vendas_estoque.signup_requests (ip, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.signup_requests TO controle_vendas_estoque_app;
GRANT USAGE ON SEQUENCE controle_vendas_estoque.signup_requests_number_seq TO controle_vendas_estoque_app;

-- Números gerais da plataforma, só para o desenvolvedor.
CREATE FUNCTION controle_vendas_estoque.platform_overview(p_user uuid)
RETURNS TABLE (
  organizations integer, organizations_suspended integer, pending_requests integer,
  users_total integer, users_today integer, users_7d integer, users_30d integer, users_never integer,
  sales_30d integer, revenue_30d numeric, netz_messages_30d integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT
    (SELECT count(*)::int FROM organizations WHERE status = 'active'),
    (SELECT count(*)::int FROM organizations WHERE status = 'suspended'),
    (SELECT count(*)::int FROM signup_requests WHERE status = 'pending'),
    (SELECT count(*)::int FROM users WHERE status = 'active'),
    (SELECT count(*)::int FROM users WHERE status = 'active' AND last_login_at >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),
    (SELECT count(*)::int FROM users WHERE status = 'active' AND last_login_at > now() - interval '7 days'),
    (SELECT count(*)::int FROM users WHERE status = 'active' AND last_login_at > now() - interval '30 days'),
    (SELECT count(*)::int FROM users WHERE status = 'active' AND last_login_at IS NULL),
    (SELECT count(*)::int FROM sales WHERE status = 'completed' AND sold_at > now() - interval '30 days'),
    (SELECT coalesce(sum(total), 0) FROM sales WHERE status = 'completed' AND sold_at > now() - interval '30 days'),
    (SELECT count(*)::int FROM nets_messages WHERE role = 'user' AND created_at > now() - interval '30 days')
   WHERE is_platform_developer(p_user)
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_overview(uuid) TO controle_vendas_estoque_app;

-- Todos os usuários da plataforma, com as empresas de cada um e o último acesso.
CREATE FUNCTION controle_vendas_estoque.platform_users(p_user uuid)
RETURNS TABLE (
  id uuid, name text, email text, status text, last_login_at timestamptz, created_at timestamptz,
  organizations text[], is_developer boolean, netz_messages_30d integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT u.id, u.name, u.email, u.status, u.last_login_at, u.created_at,
         coalesce((SELECT array_agg(o.name ORDER BY o.name) FROM memberships m JOIN organizations o ON o.id = m.organization_id
                    WHERE m.user_id = u.id AND m.status = 'active'), '{}'),
         EXISTS (SELECT 1 FROM platform_developers d WHERE d.user_id = u.id),
         (SELECT count(*)::int FROM nets_messages n WHERE n.user_id = u.id AND n.role = 'user' AND n.created_at > now() - interval '30 days')
    FROM users u
   WHERE is_platform_developer(p_user)
   ORDER BY u.last_login_at DESC NULLS LAST, u.created_at DESC
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_users(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_users(uuid) TO controle_vendas_estoque_app;
