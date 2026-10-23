-- Monitoramento de cada empresa na Plataforma: quanto já foi cadastrado,
-- o que foi feito (por tipo de ação e por onde) e as conversas das pessoas
-- com a Netz. Tudo só para quem está em platform_developers; para os demais
-- as funções não devolvem nada.

-- Cadastros e registros da empresa: total, novos em 7 e 30 dias e o último.
CREATE FUNCTION controle_vendas_estoque.platform_organization_usage(p_user uuid, p_org uuid)
RETURNS TABLE (kind text, total integer, last_7d integer, last_30d integer, last_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  WITH rec(kind, at) AS (
    SELECT 'categories', created_at FROM categories WHERE organization_id = p_org
    UNION ALL SELECT 'products', created_at FROM products WHERE organization_id = p_org
    UNION ALL SELECT 'customers', created_at FROM customers WHERE organization_id = p_org
    UNION ALL SELECT 'suppliers', created_at FROM suppliers WHERE organization_id = p_org
    UNION ALL SELECT 'sales', sold_at FROM sales WHERE organization_id = p_org AND status = 'completed'
    UNION ALL SELECT 'sales_cancelled', cancelled_at FROM sales WHERE organization_id = p_org AND status = 'cancelled'
    UNION ALL SELECT 'stock_moves', created_at FROM stock_movements WHERE organization_id = p_org AND sale_id IS NULL
    UNION ALL SELECT 'costs', created_at FROM costs WHERE organization_id = p_org AND status <> 'cancelled'
    UNION ALL SELECT 'photos', created_at FROM product_images WHERE organization_id = p_org
    UNION ALL SELECT 'netz_messages', created_at FROM nets_messages WHERE organization_id = p_org AND role = 'user'
    UNION ALL SELECT 'netz_actions', coalesce(action_decided_at, updated_at) FROM nets_messages
               WHERE organization_id = p_org AND action_status = 'done'
  ),
  kinds(kind) AS (
    VALUES ('categories'), ('products'), ('customers'), ('suppliers'), ('sales'), ('sales_cancelled'),
           ('stock_moves'), ('costs'), ('photos'), ('netz_messages'), ('netz_actions')
  )
  SELECT k.kind,
         count(r.at)::int,
         count(r.at) FILTER (WHERE r.at > now() - interval '7 days')::int,
         count(r.at) FILTER (WHERE r.at > now() - interval '30 days')::int,
         max(r.at)
    FROM kinds k LEFT JOIN rec r ON r.kind = k.kind
   WHERE is_platform_developer(p_user)
   GROUP BY k.kind
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_organization_usage(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_organization_usage(uuid, uuid) TO controle_vendas_estoque_app;

-- O que foi feito no período: ações registradas, por tipo e por onde (painel, Telegram...).
CREATE FUNCTION controle_vendas_estoque.platform_organization_action_counts(p_user uuid, p_org uuid, p_days integer)
RETURNS TABLE (action text, channel text, total integer, last_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT a.action, a.channel, count(*)::int, max(a.created_at)
    FROM audit_logs a
   WHERE a.organization_id = p_org AND is_platform_developer(p_user)
     AND a.created_at > now() - make_interval(days => least(greatest(p_days, 1), 365))
   GROUP BY a.action, a.channel
   ORDER BY count(*) DESC
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_organization_action_counts(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_organization_action_counts(uuid, uuid, integer) TO controle_vendas_estoque_app;

-- Quem conversa com a Netz nesta empresa, com o tamanho e a data de cada conversa.
CREATE FUNCTION controle_vendas_estoque.platform_organization_conversations(p_user uuid, p_org uuid)
RETURNS TABLE (
  user_id uuid, name text, email text, messages integer, user_messages integer, actions_done integer,
  channels text[], first_at timestamptz, last_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT u.id, u.name, u.email,
         count(*)::int,
         count(*) FILTER (WHERE n.role = 'user')::int,
         count(*) FILTER (WHERE n.action_status = 'done')::int,
         array_agg(DISTINCT n.channel ORDER BY n.channel),
         min(n.created_at), max(n.created_at)
    FROM nets_messages n JOIN users u ON u.id = n.user_id
   WHERE n.organization_id = p_org AND is_platform_developer(p_user)
   GROUP BY u.id, u.name, u.email
   ORDER BY max(n.created_at) DESC
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_organization_conversations(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_organization_conversations(uuid, uuid) TO controle_vendas_estoque_app;

-- As últimas mensagens da conversa de uma pessoa com a Netz, da mais antiga para a mais nova.
CREATE FUNCTION controle_vendas_estoque.platform_organization_messages(p_user uuid, p_org uuid, p_member uuid, p_limit integer)
RETURNS TABLE (
  id uuid, created_at timestamptz, role text, body text, channel text, context text, status text,
  action_title text, action_status text, action_result text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT * FROM (
    SELECT n.id, n.created_at, n.role, n.body, n.channel, n.context, n.status,
           n.action->>'title', n.action_status, n.action_result
      FROM nets_messages n
     WHERE n.organization_id = p_org AND n.user_id = p_member AND is_platform_developer(p_user)
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT least(greatest(p_limit, 1), 500)
  ) last ORDER BY created_at, id
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_organization_messages(uuid, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_organization_messages(uuid, uuid, uuid, integer) TO controle_vendas_estoque_app;
