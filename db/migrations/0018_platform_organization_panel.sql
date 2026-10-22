-- Ficha de cada empresa na Plataforma: saúde de uso, pessoas, vendas por dia,
-- atividade recente e anotações internas da equipe. Tudo só para quem está em
-- platform_developers; para os demais as funções não devolvem nada.

-- Números de uso de todas as empresas (lista e ficha).
CREATE FUNCTION controle_vendas_estoque.platform_organization_stats(p_user uuid)
RETURNS TABLE (
  organization_id uuid, sales_30d integer, revenue_30d numeric, sales_prev_30d integer, revenue_prev_30d numeric,
  sales_total integer, users_total integer, users_active_7d integer, last_activity_at timestamptz,
  products integer, customers integer, netz_messages_30d integer, telegram_links integer, improvements_open integer
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
             AND i.status IN ('new', 'analysis', 'approved', 'building'))
    FROM organizations o
   WHERE is_platform_developer(p_user)
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_organization_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_organization_stats(uuid) TO controle_vendas_estoque_app;

-- Pessoas da empresa, com perfil e último uso dentro dela.
CREATE FUNCTION controle_vendas_estoque.platform_organization_members(p_user uuid, p_org uuid)
RETURNS TABLE (
  membership_id uuid, user_id uuid, name text, email text, role_name text, is_owner boolean, status text,
  is_developer boolean, has_password boolean, last_login_at timestamptz, last_seen_at timestamptz,
  netz_messages_30d integer, sales_30d integer, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT m.id, u.id, u.name, u.email, r.name, m.is_owner, CASE WHEN u.status = 'active' THEN m.status ELSE 'disabled' END,
         EXISTS (SELECT 1 FROM platform_developers d WHERE d.user_id = u.id),
         u.password_hash IS NOT NULL, u.last_login_at,
         (SELECT max(se.last_seen_at) FROM sessions se WHERE se.user_id = u.id AND se.active_organization_id = p_org),
         (SELECT count(*)::int FROM nets_messages n WHERE n.organization_id = p_org AND n.user_id = u.id AND n.role = 'user'
             AND n.created_at > now() - interval '30 days'),
         (SELECT count(*)::int FROM sales s WHERE s.organization_id = p_org AND s.created_by = u.id AND s.status = 'completed'
             AND s.sold_at > now() - interval '30 days'),
         m.created_at
    FROM memberships m
    JOIN users u ON u.id = m.user_id
    JOIN roles r ON r.id = m.role_id
   WHERE m.organization_id = p_org AND is_platform_developer(p_user)
   ORDER BY m.is_owner DESC, m.status, u.name
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_organization_members(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_organization_members(uuid, uuid) TO controle_vendas_estoque_app;

-- Vendas por dia dos últimos 30 dias, no fuso da empresa.
CREATE FUNCTION controle_vendas_estoque.platform_organization_daily_sales(p_user uuid, p_org uuid)
RETURNS TABLE (day date, sales integer, revenue numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  WITH o AS (SELECT timezone AS tz FROM organizations WHERE id = p_org AND is_platform_developer(p_user)),
  days AS (
    SELECT d::date AS day FROM o, generate_series((now() AT TIME ZONE o.tz)::date - 29, (now() AT TIME ZONE o.tz)::date, interval '1 day') d
  )
  SELECT days.day,
         count(s.id)::int,
         coalesce(sum(s.total), 0)
    FROM days CROSS JOIN o
    LEFT JOIN sales s ON s.organization_id = p_org AND s.status = 'completed' AND (s.sold_at AT TIME ZONE o.tz)::date = days.day
   GROUP BY days.day
   ORDER BY days.day
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_organization_daily_sales(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_organization_daily_sales(uuid, uuid) TO controle_vendas_estoque_app;

-- Últimas ações registradas na empresa (auditoria).
CREATE FUNCTION controle_vendas_estoque.platform_organization_activity(p_user uuid, p_org uuid, p_limit integer)
RETURNS TABLE (id bigint, created_at timestamptz, actor_name text, channel text, action text, summary text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT a.id, a.created_at, u.name, a.channel, a.action, a.summary
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
   WHERE a.organization_id = p_org AND is_platform_developer(p_user)
   ORDER BY a.created_at DESC, a.id DESC
   LIMIT least(greatest(p_limit, 1), 200)
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_organization_activity(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_organization_activity(uuid, uuid, integer) TO controle_vendas_estoque_app;

-- Anotações internas da equipe sobre cada empresa. A empresa nunca vê.
CREATE TABLE controle_vendas_estoque.platform_organization_notes (
  organization_id uuid PRIMARY KEY REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  notes           text NOT NULL DEFAULT '' CHECK (length(notes) <= 5000),
  contact         text CHECK (contact IS NULL OR length(contact) <= 200),
  updated_by      uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE controle_vendas_estoque.platform_organization_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_organization_notes_developer ON controle_vendas_estoque.platform_organization_notes
  USING (controle_vendas_estoque.is_platform_developer(controle_vendas_estoque.current_user_id()))
  WITH CHECK (controle_vendas_estoque.is_platform_developer(controle_vendas_estoque.current_user_id()));
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.platform_organization_notes TO controle_vendas_estoque_app;
