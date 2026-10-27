-- Custo de cada chamada de IA de uma empresa, para a ficha da empresa na
-- Plataforma (pedido nº 11): de onde vem o gasto, resposta por resposta.

CREATE FUNCTION controle_vendas_estoque.platform_usage_recent(p_user uuid, p_org uuid, p_limit integer)
RETURNS TABLE (created_at timestamptz, kind text, feature text, model text, input_tokens integer, output_tokens integer,
               cache_read_tokens integer, cache_write_tokens integer, seconds numeric, cost_usd numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT u.created_at, u.kind, u.feature, u.model, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens, u.seconds, u.cost_usd
    FROM platform_usage u
   WHERE u.organization_id = p_org AND is_platform_developer(p_user)
   ORDER BY u.created_at DESC
   LIMIT least(greatest(p_limit, 1), 200)
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_usage_recent(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_usage_recent(uuid, uuid, integer) TO controle_vendas_estoque_app;
