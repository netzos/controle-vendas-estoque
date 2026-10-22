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
