-- Empresas da plataforma: o desenvolvedor vê todas as empresas (nome, dono,
-- tamanho), sem acesso aos dados de dentro delas. Só para quem está em
-- platform_developers; para os demais a função não devolve nada.
CREATE FUNCTION controle_vendas_estoque.platform_organizations(p_user uuid)
RETURNS TABLE (
  id uuid, name text, status text, created_at timestamptz,
  owner_name text, owner_email text, owner_membership_id uuid, owner_last_login_at timestamptz,
  members integer, sales integer, last_sale_at timestamptz, developer_is_member boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT o.id, o.name, o.status, o.created_at,
         ow.name, ow.email, ow.membership_id, ow.last_login_at,
         (SELECT count(*)::int FROM memberships m WHERE m.organization_id = o.id AND m.status = 'active'),
         (SELECT count(*)::int FROM sales s WHERE s.organization_id = o.id),
         (SELECT max(s.created_at) FROM sales s WHERE s.organization_id = o.id),
         EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = p_user AND m.status = 'active')
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
