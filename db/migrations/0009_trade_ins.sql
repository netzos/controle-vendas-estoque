-- Troca como parte do pagamento: o cliente entrega um item (carro, celular,
-- relógio...) que vale parte do preço. O item entra no estoque com o valor
-- dado na troca como custo.

ALTER TABLE controle_vendas_estoque.stock_movements DROP CONSTRAINT stock_movements_kind_check;
ALTER TABLE controle_vendas_estoque.stock_movements ADD CONSTRAINT stock_movements_kind_check
  CHECK (kind IN ('in', 'out', 'adjust', 'sale', 'sale_cancel', 'trade_in'));

ALTER TABLE controle_vendas_estoque.sales
  ADD COLUMN trade_in_total numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE controle_vendas_estoque.sales
  ADD CONSTRAINT sales_trade_in_total_check CHECK (trade_in_total >= 0 AND trade_in_total <= total);

CREATE TABLE controle_vendas_estoque.sale_trade_ins (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  sale_id           uuid NOT NULL REFERENCES controle_vendas_estoque.sales(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL,
  quantity          numeric(14,3) NOT NULL CHECK (quantity > 0),
  value             numeric(14,2) NOT NULL CHECK (value >= 0),
  notes             text CHECK (notes IS NULL OR length(notes) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, product_id) REFERENCES controle_vendas_estoque.products (organization_id, id)
);
CREATE INDEX sale_trade_ins_sale_idx ON controle_vendas_estoque.sale_trade_ins (sale_id);

ALTER TABLE controle_vendas_estoque.sale_trade_ins ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_trade_ins_tenant ON controle_vendas_estoque.sale_trade_ins
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());

GRANT SELECT, INSERT ON controle_vendas_estoque.sale_trade_ins TO controle_vendas_estoque_app;

INSERT INTO controle_vendas_estoque.permissions (key, module, description, risk_level) VALUES
  ('sales.trade_in', 'comercial', 'Aceitar item na troca como parte do pagamento', 3)
ON CONFLICT (key) DO NOTHING;

INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, 'sales.trade_in'
  FROM controle_vendas_estoque.roles r
 WHERE r.is_system AND r.key IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
