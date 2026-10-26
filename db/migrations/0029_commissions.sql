-- Comissões (primeira versão): cada vendedor tem uma taxa (% sobre o valor das
-- vendas que ele registrou). O painel calcula quanto cada um ganhou no período,
-- o ranking, e guarda cada repasse feito. Recurso opcional (Ajustes › Recursos).
CREATE TABLE controle_vendas_estoque.commission_rates (
  organization_id  uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  rate             numeric(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  updated_by       uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE controle_vendas_estoque.commission_payouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES controle_vendas_estoque.users(id),
  -- Mês de referência (primeiro dia do mês).
  period           date NOT NULL,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  method           text CHECK (method IS NULL OR method IN ('cash', 'pix', 'other')),
  notes            text CHECK (notes IS NULL OR length(notes) <= 300),
  created_by       uuid NOT NULL REFERENCES controle_vendas_estoque.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commission_payouts_period_idx ON controle_vendas_estoque.commission_payouts (organization_id, period, user_id);
ALTER TABLE controle_vendas_estoque.commission_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.commission_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY commission_rates_tenant ON controle_vendas_estoque.commission_rates
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY commission_payouts_tenant ON controle_vendas_estoque.commission_payouts
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.commission_rates TO controle_vendas_estoque_app;
GRANT SELECT, INSERT ON controle_vendas_estoque.commission_payouts TO controle_vendas_estoque_app;

INSERT INTO controle_vendas_estoque.permissions (key, module, description, risk_level) VALUES
  ('commissions.view', 'comercial', 'Ver comissões e o ranking de vendedores', 1),
  ('commissions.manage', 'comercial', 'Definir a taxa de comissão e registrar repasses', 3)
ON CONFLICT (key) DO NOTHING;
INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, g.key
  FROM controle_vendas_estoque.roles r
  JOIN (VALUES ('owner', 'commissions.view'), ('owner', 'commissions.manage'), ('admin', 'commissions.view'), ('admin', 'commissions.manage'),
               ('finance', 'commissions.view'), ('finance', 'commissions.manage')) AS g(role_key, key) ON g.role_key = r.key
 WHERE r.is_system
ON CONFLICT DO NOTHING;
