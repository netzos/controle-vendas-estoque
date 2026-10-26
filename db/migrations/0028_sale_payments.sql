-- Pagamento dividido e pagamento parcial.
-- Uma venda pode ser paga em várias formas (parte no Pix, parte no débito) e
-- pode ficar com saldo a receber. Cada recebimento é uma linha; a venda guarda
-- o total recebido e a situação do pagamento:
--   paid    = recebido tudo (total menos o que veio em troca)
--   partial = recebeu uma parte
--   pending = não recebeu nada ainda
-- sales.payment_method continua existindo: é a forma principal (a de maior valor).
CREATE TABLE controle_vendas_estoque.sale_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  sale_id          uuid NOT NULL,
  method           text NOT NULL CHECK (method IN ('cash', 'pix', 'credit', 'debit', 'other')),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_at          timestamptz NOT NULL DEFAULT now(),
  notes            text CHECK (notes IS NULL OR length(notes) <= 300),
  created_by       uuid NOT NULL REFERENCES controle_vendas_estoque.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, sale_id) REFERENCES controle_vendas_estoque.sales (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX sale_payments_sale_idx ON controle_vendas_estoque.sale_payments (organization_id, sale_id);
CREATE INDEX sale_payments_paid_idx ON controle_vendas_estoque.sale_payments (organization_id, paid_at DESC);
ALTER TABLE controle_vendas_estoque.sale_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_payments_tenant ON controle_vendas_estoque.sale_payments
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
GRANT SELECT, INSERT ON controle_vendas_estoque.sale_payments TO controle_vendas_estoque_app;

ALTER TABLE controle_vendas_estoque.sales
  ADD COLUMN paid_total     numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  ADD COLUMN payment_status text NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'partial', 'pending'));
CREATE INDEX sales_open_payment_idx ON controle_vendas_estoque.sales (organization_id) WHERE payment_status <> 'paid';

-- Vendas de antes: foram pagas inteiras na forma escolhida.
INSERT INTO controle_vendas_estoque.sale_payments (organization_id, sale_id, method, amount, paid_at, created_by, created_at)
SELECT organization_id, id, payment_method, total - trade_in_total, sold_at, created_by, sold_at
  FROM controle_vendas_estoque.sales WHERE total > trade_in_total;
UPDATE controle_vendas_estoque.sales SET paid_total = total - trade_in_total;

INSERT INTO controle_vendas_estoque.permissions (key, module, description, risk_level) VALUES
  ('sales.receive', 'comercial', 'Registrar o recebimento do que falta pagar de uma venda', 3)
ON CONFLICT (key) DO NOTHING;
INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, 'sales.receive'
  FROM controle_vendas_estoque.roles r
 WHERE r.is_system AND r.key IN ('owner', 'admin', 'sales', 'finance')
ON CONFLICT DO NOTHING;
