-- Melhorias na Plataforma: pedidos parecidos de empresas diferentes viram um
-- só (o pedido juntado aponta para o principal e segue a situação dele), e a
-- análise da IA sobre todos os pedidos abertos fica guardada.
ALTER TABLE controle_vendas_estoque.improvements
  ADD COLUMN merged_into uuid REFERENCES controle_vendas_estoque.improvements(id) ON DELETE SET NULL,
  -- Número do principal, guardado aqui porque a empresa não enxerga pedidos de outras.
  ADD COLUMN merged_into_number bigint,
  ADD CHECK (merged_into IS NULL OR merged_into <> id);
CREATE INDEX improvements_merged_idx ON controle_vendas_estoque.improvements (merged_into) WHERE merged_into IS NOT NULL;

CREATE TABLE controle_vendas_estoque.improvement_analyses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  -- { resumo, grupos: [{ titulo, numeros, motivo }], necessidades: [{ empresa, resumo }], prioridades: [...] }
  result      jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  items       integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Só o desenvolvedor da plataforma lê e grava.
ALTER TABLE controle_vendas_estoque.improvement_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY improvement_analyses_developer ON controle_vendas_estoque.improvement_analyses
  USING (controle_vendas_estoque.is_platform_developer(controle_vendas_estoque.current_user_id()))
  WITH CHECK (controle_vendas_estoque.is_platform_developer(controle_vendas_estoque.current_user_id()));
GRANT SELECT, INSERT ON controle_vendas_estoque.improvement_analyses TO controle_vendas_estoque_app;

-- Liberações: cada parte do sistema pode ser ligada ou desligada por empresa.
-- Sem linha, vale o padrão da parte (definido no código).
CREATE TABLE controle_vendas_estoque.organization_features (
  organization_id uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  feature_key     text NOT NULL CHECK (feature_key ~ '^[a-z_]{2,40}$'),
  enabled         boolean NOT NULL,
  updated_by      uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, feature_key)
);
ALTER TABLE controle_vendas_estoque.organization_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_features_tenant ON controle_vendas_estoque.organization_features
  USING (organization_id = controle_vendas_estoque.current_org())
  WITH CHECK (organization_id = controle_vendas_estoque.current_org());
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.organization_features TO controle_vendas_estoque_app;

-- Liberações de todas as empresas, para a tela da Plataforma.
CREATE FUNCTION controle_vendas_estoque.platform_features(p_user uuid)
RETURNS TABLE (organization_id uuid, feature_key text, enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT f.organization_id, f.feature_key, f.enabled FROM organization_features f WHERE is_platform_developer(p_user)
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_features(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_features(uuid) TO controle_vendas_estoque_app;
