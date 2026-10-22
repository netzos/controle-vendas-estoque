-- Painel da plataforma repaginado: empresas internas da equipe separadas dos
-- clientes, liberações com padrão por parte do sistema (para escalar a milhares
-- de empresas), custo de uso por empresa (IA, áudio), mensalidade de cada
-- empresa, custos fixos da plataforma e os indicadores do dashboard.

-- Tipo da empresa: cliente ou interna da equipe (casa da equipe, testes).
-- Internas ficam fora das listas, dos números e dos usuários da Plataforma.
ALTER TABLE controle_vendas_estoque.organizations
  ADD COLUMN kind text NOT NULL DEFAULT 'customer' CHECK (kind IN ('customer', 'internal'));
UPDATE controle_vendas_estoque.organizations SET kind = 'internal' WHERE name IN ('netzsales', 'Demonstração (dados fictícios)');

DROP FUNCTION controle_vendas_estoque.platform_organizations(uuid);
CREATE FUNCTION controle_vendas_estoque.platform_organizations(p_user uuid)
RETURNS TABLE (
  id uuid, name text, status text, created_at timestamptz,
  owner_name text, owner_email text, owner_membership_id uuid, owner_last_login_at timestamptz,
  members integer, sales integer, last_sale_at timestamptz, developer_is_member boolean, kind text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT o.id, o.name, o.status, o.created_at,
         ow.name, ow.email, ow.membership_id, ow.last_login_at,
         (SELECT count(*)::int FROM memberships m WHERE m.organization_id = o.id AND m.status = 'active'),
         (SELECT count(*)::int FROM sales s WHERE s.organization_id = o.id),
         (SELECT max(s.created_at) FROM sales s WHERE s.organization_id = o.id),
         EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = p_user AND m.status = 'active'),
         o.kind
    FROM organizations o
    LEFT JOIN LATERAL (
      -- Dono principal: o proprietário mais antigo que não é desenvolvedor da plataforma.
      SELECT u.name, u.email, m.id AS membership_id, u.last_login_at
        FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = o.id AND m.is_owner AND m.status = 'active'
       ORDER BY (m.user_id IN (SELECT user_id FROM platform_developers)), m.created_at
       LIMIT 1
    ) ow ON true
   WHERE is_platform_developer(p_user)
   ORDER BY o.created_at
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_organizations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_organizations(uuid) TO controle_vendas_estoque_app;

-- Usuários: empresas de cliente separadas das internas.
DROP FUNCTION controle_vendas_estoque.platform_users(uuid);
CREATE FUNCTION controle_vendas_estoque.platform_users(p_user uuid)
RETURNS TABLE (
  id uuid, name text, email text, status text, last_login_at timestamptz, created_at timestamptz,
  organizations text[], internal_organizations text[], organization_ids uuid[], is_developer boolean,
  netz_messages_30d integer, last_seen_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT u.id, u.name, u.email, u.status, u.last_login_at, u.created_at,
         coalesce((SELECT array_agg(o.name ORDER BY o.name) FROM memberships m JOIN organizations o ON o.id = m.organization_id
                    WHERE m.user_id = u.id AND m.status = 'active' AND o.kind = 'customer'), '{}'),
         coalesce((SELECT array_agg(o.name ORDER BY o.name) FROM memberships m JOIN organizations o ON o.id = m.organization_id
                    WHERE m.user_id = u.id AND m.status = 'active' AND o.kind = 'internal'), '{}'),
         coalesce((SELECT array_agg(o.id ORDER BY o.name) FROM memberships m JOIN organizations o ON o.id = m.organization_id
                    WHERE m.user_id = u.id AND m.status = 'active' AND o.kind = 'customer'), '{}'),
         EXISTS (SELECT 1 FROM platform_developers d WHERE d.user_id = u.id),
         (SELECT count(*)::int FROM nets_messages n WHERE n.user_id = u.id AND n.role = 'user' AND n.created_at > now() - interval '30 days'),
         (SELECT max(se.last_seen_at) FROM sessions se WHERE se.user_id = u.id)
    FROM users u
   WHERE is_platform_developer(p_user)
   ORDER BY greatest(u.last_login_at, (SELECT max(se.last_seen_at) FROM sessions se WHERE se.user_id = u.id)) DESC NULLS LAST, u.created_at DESC
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_users(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_users(uuid) TO controle_vendas_estoque_app;

-- Custo de uso: cada chamada paga que o sistema faz por uma empresa (IA da
-- Netz, transcrição de áudio...). O valor é calculado na hora, em dólar.
CREATE TABLE controle_vendas_estoque.platform_usage (
  id                 bigserial PRIMARY KEY,
  organization_id    uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  kind               text NOT NULL CHECK (kind IN ('ai', 'transcription')),
  feature            text NOT NULL CHECK (feature ~ '^[a-z_]{2,40}$'),
  provider           text NOT NULL,
  model              text NOT NULL,
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  seconds            numeric(10, 1) NOT NULL DEFAULT 0,
  cost_usd           numeric(12, 6) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_usage_org_time_idx ON controle_vendas_estoque.platform_usage (organization_id, created_at DESC);
CREATE INDEX platform_usage_time_idx ON controle_vendas_estoque.platform_usage (created_at DESC);
ALTER TABLE controle_vendas_estoque.platform_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_usage_tenant ON controle_vendas_estoque.platform_usage
  USING (organization_id = controle_vendas_estoque.current_org())
  WITH CHECK (organization_id = controle_vendas_estoque.current_org());
GRANT SELECT, INSERT ON controle_vendas_estoque.platform_usage TO controle_vendas_estoque_app;
GRANT USAGE ON SEQUENCE controle_vendas_estoque.platform_usage_id_seq TO controle_vendas_estoque_app;

-- Mensalidade de cada empresa (preenchida pela equipe; cobrança automática vem depois).
CREATE TABLE controle_vendas_estoque.organization_billing (
  organization_id uuid PRIMARY KEY REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  plan_name       text CHECK (plan_name IS NULL OR length(plan_name) <= 80),
  monthly_price   numeric(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  status          text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'paying', 'free', 'overdue', 'cancelled')),
  notes           text CHECK (notes IS NULL OR length(notes) <= 2000),
  updated_by      uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE controle_vendas_estoque.organization_billing ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_billing_tenant ON controle_vendas_estoque.organization_billing
  USING (organization_id = controle_vendas_estoque.current_org())
  WITH CHECK (organization_id = controle_vendas_estoque.current_org());
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.organization_billing TO controle_vendas_estoque_app;

-- Custos fixos da plataforma por mês (servidor, banco, domínio...), em reais.
-- O código só deixa o administrador da plataforma ler e mexer.
CREATE TABLE controle_vendas_estoque.platform_fixed_costs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  monthly_brl   numeric(12, 2) NOT NULL CHECK (monthly_brl >= 0),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  updated_by    uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.platform_fixed_costs TO controle_vendas_estoque_app;

-- Ajustes gerais da plataforma (ex.: cotação do dólar usada nos custos).
CREATE TABLE controle_vendas_estoque.platform_settings (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,40}$'),
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.platform_settings TO controle_vendas_estoque_app;
INSERT INTO controle_vendas_estoque.platform_settings (key, value) VALUES ('usd_brl', '5.5');

-- Liberações: padrão de cada parte do sistema (vale para todas as empresas,
-- inclusive as novas). Uma linha em organization_features diferente do padrão
-- é uma exceção daquela empresa. Sem linha aqui, vale o padrão do código.
CREATE TABLE controle_vendas_estoque.platform_feature_defaults (
  feature_key text PRIMARY KEY CHECK (feature_key ~ '^[a-z_]{2,40}$'),
  enabled     boolean NOT NULL,
  updated_by  uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON controle_vendas_estoque.platform_feature_defaults TO controle_vendas_estoque_app;

-- Liga ou desliga uma parte para todas as empresas de uma vez (e para as
-- novas): grava o padrão e desfaz as exceções.
CREATE FUNCTION controle_vendas_estoque.platform_set_feature_default(p_user uuid, p_key text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
BEGIN
  IF NOT is_platform_developer(p_user) THEN
    RAISE EXCEPTION 'só o administrador da plataforma' USING ERRCODE = '42501';
  END IF;
  INSERT INTO platform_feature_defaults (feature_key, enabled, updated_by) VALUES (p_key, p_enabled, p_user)
  ON CONFLICT (feature_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now();
  UPDATE organization_features SET enabled = p_enabled, updated_by = p_user, updated_at = now()
   WHERE feature_key = p_key AND enabled <> p_enabled;
END
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_set_feature_default(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_set_feature_default(uuid, text, boolean) TO controle_vendas_estoque_app;

-- Exclui de vez uma empresa interna ou suspensa, com todos os dados dela.
-- Empresa de cliente ativa precisa ser suspensa antes (proteção contra engano).
CREATE FUNCTION controle_vendas_estoque.platform_delete_organization(p_user uuid, p_org uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT is_platform_developer(p_user) THEN
    RAISE EXCEPTION 'só o administrador da plataforma' USING ERRCODE = '42501';
  END IF;
  SELECT name INTO v_name FROM organizations WHERE id = p_org AND (kind = 'internal' OR status = 'suspended');
  IF v_name IS NULL THEN
    RETURN NULL;
  END IF;
  DELETE FROM organizations WHERE id = p_org;
  RETURN v_name;
END
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_delete_organization(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_delete_organization(uuid, uuid) TO controle_vendas_estoque_app;

-- Números de cada empresa: os de antes mais mensalidade e custo de uso.
DROP FUNCTION controle_vendas_estoque.platform_organization_stats(uuid);
CREATE FUNCTION controle_vendas_estoque.platform_organization_stats(p_user uuid)
RETURNS TABLE (
  organization_id uuid, sales_30d integer, revenue_30d numeric, sales_prev_30d integer, revenue_prev_30d numeric,
  sales_total integer, users_total integer, users_active_7d integer, last_activity_at timestamptz,
  products integer, customers integer, netz_messages_30d integer, telegram_links integer, improvements_open integer,
  first_sale_at timestamptz, plan_name text, monthly_price numeric, billing_status text, usage_cost_30d_usd numeric,
  usage_cost_month_usd numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT o.id,
         (SELECT count(*)::int FROM sales s WHERE s.organization_id = o.id AND s.status = 'completed' AND s.sold_at > now() - interval '30 days'),
         (SELECT coalesce(sum(s.total), 0) FROM sales s WHERE s.organization_id = o.id AND s.status = 'completed' AND s.sold_at > now() - interval '30 days'),
         (SELECT count(*)::int FROM sales s WHERE s.organization_id = o.id AND s.status = 'completed'
             AND s.sold_at > now() - interval '60 days' AND s.sold_at <= now() - interval '30 days'),
         (SELECT coalesce(sum(s.total), 0) FROM sales s WHERE s.organization_id = o.id AND s.status = 'completed'
             AND s.sold_at > now() - interval '60 days' AND s.sold_at <= now() - interval '30 days'),
         (SELECT count(*)::int FROM sales s WHERE s.organization_id = o.id AND s.status = 'completed'),
         -- A equipe da plataforma não conta como usuário da empresa.
         (SELECT count(*)::int FROM memberships m WHERE m.organization_id = o.id AND m.status = 'active'
             AND m.user_id NOT IN (SELECT user_id FROM platform_developers)),
         (SELECT count(DISTINCT se.user_id)::int FROM sessions se JOIN memberships m ON m.user_id = se.user_id AND m.organization_id = o.id
           WHERE se.active_organization_id = o.id AND se.last_seen_at > now() - interval '7 days'
             AND se.user_id NOT IN (SELECT user_id FROM platform_developers)),
         (SELECT max(se.last_seen_at) FROM sessions se
           WHERE se.active_organization_id = o.id AND se.user_id NOT IN (SELECT user_id FROM platform_developers)),
         (SELECT count(*)::int FROM products p WHERE p.organization_id = o.id AND p.status = 'active'),
         (SELECT count(*)::int FROM customers c WHERE c.organization_id = o.id AND c.status = 'active'),
         (SELECT count(*)::int FROM nets_messages n WHERE n.organization_id = o.id AND n.role = 'user' AND n.created_at > now() - interval '30 days'),
         (SELECT count(*)::int FROM telegram_links t WHERE t.organization_id = o.id AND t.status = 'active'),
         (SELECT count(*)::int FROM improvements i WHERE i.organization_id = o.id AND i.merged_into IS NULL
             AND i.status IN ('new', 'analysis', 'approved', 'building')),
         (SELECT min(s.created_at) FROM sales s WHERE s.organization_id = o.id),
         b.plan_name, coalesce(b.monthly_price, 0), coalesce(b.status, 'trial'),
         (SELECT coalesce(sum(u.cost_usd), 0) FROM platform_usage u WHERE u.organization_id = o.id AND u.created_at > now() - interval '30 days'),
         (SELECT coalesce(sum(u.cost_usd), 0) FROM platform_usage u WHERE u.organization_id = o.id
             AND u.created_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')
    FROM organizations o
    LEFT JOIN organization_billing b ON b.organization_id = o.id
   WHERE is_platform_developer(p_user)
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_organization_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_organization_stats(uuid) TO controle_vendas_estoque_app;

-- Indicadores do dashboard da plataforma, só de empresas de cliente e de
-- pessoas de fora da equipe. Séries mensais dos últimos 12 meses e semanais
-- das últimas 12 semanas (fuso de São Paulo).
DROP FUNCTION controle_vendas_estoque.platform_overview(uuid);
CREATE FUNCTION controle_vendas_estoque.platform_dashboard(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  WITH cust AS (SELECT * FROM organizations WHERE kind = 'customer'),
  devs AS (SELECT user_id FROM platform_developers),
  -- Pessoas de cliente: têm vínculo ativo com alguma empresa de cliente e não são da equipe.
  people AS (
    SELECT u.id, u.created_at, u.last_login_at,
           greatest(u.last_login_at, (SELECT max(se.last_seen_at) FROM sessions se WHERE se.user_id = u.id)) AS seen
      FROM users u
     WHERE u.status = 'active' AND u.id NOT IN (SELECT user_id FROM devs)
       AND EXISTS (SELECT 1 FROM memberships m JOIN cust o ON o.id = m.organization_id WHERE m.user_id = u.id AND m.status = 'active')
  ),
  -- Atividade de clientes: ações registradas por pessoas de fora da equipe.
  acts AS (
    SELECT a.organization_id, a.created_at FROM audit_logs a JOIN cust o ON o.id = a.organization_id
     WHERE a.actor_user_id IS NOT NULL AND a.actor_user_id NOT IN (SELECT user_id FROM devs)
       AND a.created_at > now() - interval '13 months'
    UNION ALL
    SELECT n.organization_id, n.created_at FROM nets_messages n JOIN cust o ON o.id = n.organization_id
     WHERE n.role = 'user' AND n.user_id NOT IN (SELECT user_id FROM devs) AND n.created_at > now() - interval '13 months'
  ),
  months AS (
    SELECT generate_series(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '11 months',
                           date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'), interval '1 month') AS m
  ),
  weeks AS (
    SELECT generate_series(date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') - interval '11 weeks',
                           date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo'), interval '1 week') AS w
  ),
  first_sale AS (
    SELECT s.organization_id, min(s.created_at) AS at FROM sales s JOIN cust o ON o.id = s.organization_id GROUP BY 1
  ),
  bill AS (
    SELECT o.id, o.status AS org_status, coalesce(b.status, 'trial') AS status, coalesce(b.monthly_price, 0) AS price
      FROM cust o LEFT JOIN organization_billing b ON b.organization_id = o.id
  ),
  usage30 AS (
    SELECT u.organization_id, o.kind, sum(u.cost_usd) AS usd
      FROM platform_usage u JOIN organizations o ON o.id = u.organization_id
     WHERE u.created_at > now() - interval '30 days' GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'companies', jsonb_build_object(
      'total', (SELECT count(*) FROM cust),
      'active', (SELECT count(*) FROM cust WHERE status = 'active'),
      'suspended', (SELECT count(*) FROM cust WHERE status = 'suspended'),
      'new30d', (SELECT count(*) FROM cust WHERE created_at > now() - interval '30 days'),
      'newPrev30d', (SELECT count(*) FROM cust WHERE created_at > now() - interval '60 days' AND created_at <= now() - interval '30 days'),
      'activeLast7d', (SELECT count(DISTINCT organization_id) FROM acts WHERE created_at > now() - interval '7 days'),
      'activePrev7d', (SELECT count(DISTINCT organization_id) FROM acts WHERE created_at > now() - interval '14 days' AND created_at <= now() - interval '7 days'),
      'activeLast30d', (SELECT count(DISTINCT organization_id) FROM acts WHERE created_at > now() - interval '30 days')
    ),
    'users', jsonb_build_object(
      'total', (SELECT count(*) FROM people),
      'new30d', (SELECT count(*) FROM people WHERE created_at > now() - interval '30 days'),
      'today', (SELECT count(*) FROM people WHERE seen >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),
      'last7d', (SELECT count(*) FROM people WHERE seen > now() - interval '7 days'),
      'last30d', (SELECT count(*) FROM people WHERE seen > now() - interval '30 days'),
      'never', (SELECT count(*) FROM people WHERE last_login_at IS NULL)
    ),
    'signups', jsonb_build_object(
      'pending', (SELECT count(*) FROM signup_requests WHERE status = 'pending'),
      'last30d', (SELECT count(*) FROM signup_requests WHERE created_at > now() - interval '30 days'),
      'approved30d', (SELECT count(*) FROM signup_requests WHERE status = 'approved' AND created_at > now() - interval '30 days'),
      'rejected30d', (SELECT count(*) FROM signup_requests WHERE status = 'rejected' AND created_at > now() - interval '30 days'),
      'avgHoursToDecide', (SELECT round(avg(extract(epoch FROM decided_at - created_at) / 3600)::numeric, 1)
                             FROM signup_requests WHERE decided_at IS NOT NULL AND created_at > now() - interval '90 days')
    ),
    'activation', jsonb_build_object(
      'created90d', (SELECT count(*) FROM cust WHERE created_at > now() - interval '90 days'),
      'withSale90d', (SELECT count(*) FROM cust o JOIN first_sale f ON f.organization_id = o.id WHERE o.created_at > now() - interval '90 days'),
      'medianDaysToFirstSale', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM f.at - o.created_at) / 86400))::numeric, 1)
                                  FROM cust o JOIN first_sale f ON f.organization_id = o.id WHERE o.created_at > now() - interval '90 days')
    ),
    'usage', jsonb_build_object(
      'sales30d', (SELECT count(*) FROM sales s JOIN cust o ON o.id = s.organization_id WHERE s.status = 'completed' AND s.sold_at > now() - interval '30 days'),
      'salesPrev30d', (SELECT count(*) FROM sales s JOIN cust o ON o.id = s.organization_id WHERE s.status = 'completed'
                          AND s.sold_at > now() - interval '60 days' AND s.sold_at <= now() - interval '30 days'),
      'gmv30d', (SELECT coalesce(sum(s.total), 0) FROM sales s JOIN cust o ON o.id = s.organization_id WHERE s.status = 'completed' AND s.sold_at > now() - interval '30 days'),
      'gmvPrev30d', (SELECT coalesce(sum(s.total), 0) FROM sales s JOIN cust o ON o.id = s.organization_id WHERE s.status = 'completed'
                        AND s.sold_at > now() - interval '60 days' AND s.sold_at <= now() - interval '30 days'),
      'netzMessages30d', (SELECT count(*) FROM nets_messages n JOIN cust o ON o.id = n.organization_id WHERE n.role = 'user' AND n.created_at > now() - interval '30 days'),
      'telegramLinks', (SELECT count(*) FROM telegram_links t JOIN cust o ON o.id = t.organization_id WHERE t.status = 'active'),
      'improvementsOpen', (SELECT count(*) FROM improvements i WHERE i.merged_into IS NULL AND i.status IN ('new', 'analysis', 'approved', 'building'))
    ),
    'money', jsonb_build_object(
      'mrr', (SELECT coalesce(sum(price), 0) FROM bill WHERE org_status = 'active' AND status IN ('paying', 'overdue')),
      'paying', (SELECT count(*) FROM bill WHERE org_status = 'active' AND status = 'paying'),
      'overdue', (SELECT count(*) FROM bill WHERE org_status = 'active' AND status = 'overdue'),
      'trial', (SELECT count(*) FROM bill WHERE org_status = 'active' AND status = 'trial'),
      'free', (SELECT count(*) FROM bill WHERE org_status = 'active' AND status = 'free'),
      'usageCustomers30dUsd', (SELECT coalesce(sum(usd), 0) FROM usage30 WHERE kind = 'customer'),
      'usageInternal30dUsd', (SELECT coalesce(sum(usd), 0) FROM usage30 WHERE kind = 'internal'),
      'fixedMonthlyBrl', (SELECT coalesce(sum(monthly_brl), 0) FROM platform_fixed_costs WHERE status = 'active'),
      'usdBrl', (SELECT (value #>> '{}')::numeric FROM platform_settings WHERE key = 'usd_brl')
    ),
    'monthly', (
      SELECT jsonb_agg(jsonb_build_object(
        'month', to_char(m, 'YYYY-MM'),
        'newCompanies', (SELECT count(*) FROM cust o WHERE date_trunc('month', o.created_at AT TIME ZONE 'America/Sao_Paulo') = m),
        'activeCompanies', (SELECT count(DISTINCT a.organization_id) FROM acts a WHERE date_trunc('month', a.created_at AT TIME ZONE 'America/Sao_Paulo') = m),
        'newUsers', (SELECT count(*) FROM people p WHERE date_trunc('month', p.created_at AT TIME ZONE 'America/Sao_Paulo') = m),
        'gmv', (SELECT coalesce(sum(s.total), 0) FROM sales s JOIN cust o ON o.id = s.organization_id
                 WHERE s.status = 'completed' AND date_trunc('month', s.sold_at AT TIME ZONE 'America/Sao_Paulo') = m),
        'costUsd', (SELECT coalesce(sum(u.cost_usd), 0) FROM platform_usage u WHERE date_trunc('month', u.created_at AT TIME ZONE 'America/Sao_Paulo') = m)
      ) ORDER BY m) FROM months
    ),
    'weekly', (
      SELECT jsonb_agg(jsonb_build_object(
        'week', to_char(w, 'YYYY-MM-DD'),
        'activeCompanies', (SELECT count(DISTINCT a.organization_id) FROM acts a WHERE date_trunc('week', a.created_at AT TIME ZONE 'America/Sao_Paulo') = w)
      ) ORDER BY w) FROM weeks
    )
  )
  WHERE is_platform_developer(p_user)
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_dashboard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_dashboard(uuid) TO controle_vendas_estoque_app;

-- Custo de uso de todas as empresas, por empresa e por tipo, num período.
CREATE FUNCTION controle_vendas_estoque.platform_usage_summary(p_user uuid, p_since timestamptz)
RETURNS TABLE (organization_id uuid, kind text, feature text, calls integer, input_tokens bigint, output_tokens bigint, seconds numeric, cost_usd numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT u.organization_id, u.kind, u.feature, count(*)::int, sum(u.input_tokens + u.cache_read_tokens + u.cache_write_tokens)::bigint,
         sum(u.output_tokens)::bigint, sum(u.seconds), sum(u.cost_usd)
    FROM platform_usage u
   WHERE u.created_at >= p_since AND is_platform_developer(p_user)
   GROUP BY 1, 2, 3
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_usage_summary(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_usage_summary(uuid, timestamptz) TO controle_vendas_estoque_app;
