-- Fase 3: Vendas e estoque.
-- Toda venda baixa o estoque na mesma transação; o saldo do produto é a soma
-- das movimentações e fica guardado em products.stock_qty para leitura rápida.

ALTER TABLE controle_vendas_estoque.products
  ADD COLUMN stock_qty   numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN track_stock boolean NOT NULL DEFAULT true;

CREATE TABLE controle_vendas_estoque.sales (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  number            integer NOT NULL CHECK (number > 0),
  customer_id       uuid,
  status            text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  payment_method    text NOT NULL CHECK (payment_method IN ('cash', 'pix', 'credit', 'debit', 'other')),
  subtotal          numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  discount          numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total             numeric(14,2) NOT NULL CHECK (total >= 0),
  cost_total        numeric(14,4) NOT NULL DEFAULT 0 CHECK (cost_total >= 0),
  notes             text CHECK (notes IS NULL OR length(notes) <= 1000),
  sold_at           timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES controle_vendas_estoque.users(id),
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES controle_vendas_estoque.users(id),
  cancel_reason     text CHECK (cancel_reason IS NULL OR length(cancel_reason) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, customer_id) REFERENCES controle_vendas_estoque.customers (organization_id, id),
  CHECK (total = subtotal - discount),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX sales_sold_at_idx ON controle_vendas_estoque.sales (organization_id, sold_at DESC);
CREATE TRIGGER sales_touch BEFORE UPDATE ON controle_vendas_estoque.sales
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

CREATE TABLE controle_vendas_estoque.sale_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  sale_id           uuid NOT NULL,
  product_id        uuid NOT NULL,
  quantity          numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price        numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost         numeric(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total             numeric(14,2) NOT NULL CHECK (total >= 0),
  FOREIGN KEY (organization_id, sale_id) REFERENCES controle_vendas_estoque.sales (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, product_id) REFERENCES controle_vendas_estoque.products (organization_id, id)
);
CREATE INDEX sale_items_sale_idx ON controle_vendas_estoque.sale_items (sale_id);
CREATE INDEX sale_items_product_idx ON controle_vendas_estoque.sale_items (organization_id, product_id);

CREATE TABLE controle_vendas_estoque.stock_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('in', 'out', 'adjust', 'sale', 'sale_cancel')),
  -- Positivo entra, negativo sai.
  quantity          numeric(14,3) NOT NULL CHECK (quantity <> 0),
  balance_after     numeric(14,3) NOT NULL,
  unit_cost         numeric(14,4),
  sale_id           uuid,
  notes             text CHECK (notes IS NULL OR length(notes) <= 500),
  created_by        uuid NOT NULL REFERENCES controle_vendas_estoque.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, product_id) REFERENCES controle_vendas_estoque.products (organization_id, id),
  FOREIGN KEY (organization_id, sale_id) REFERENCES controle_vendas_estoque.sales (organization_id, id)
);
CREATE INDEX stock_movements_product_idx ON controle_vendas_estoque.stock_movements (organization_id, product_id, created_at DESC);
CREATE INDEX stock_movements_created_idx ON controle_vendas_estoque.stock_movements (organization_id, created_at DESC);

-- Row Level Security ---------------------------------------------------------

ALTER TABLE controle_vendas_estoque.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_tenant ON controle_vendas_estoque.sales
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY sale_items_tenant ON controle_vendas_estoque.sale_items
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY stock_movements_tenant ON controle_vendas_estoque.stock_movements
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());

-- Vendas são canceladas, nunca apagadas; movimentações são só inseridas.
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.sales, controle_vendas_estoque.sale_items TO controle_vendas_estoque_app;
GRANT SELECT, INSERT ON controle_vendas_estoque.stock_movements TO controle_vendas_estoque_app;

-- Permissões novas e concessão aos perfis padrão das empresas já existentes.
INSERT INTO controle_vendas_estoque.permissions (key, module, description, risk_level) VALUES
  ('sales.view', 'comercial', 'Ver vendas e o painel de vendas', 1),
  ('sales.create', 'comercial', 'Registrar vendas', 3),
  ('sales.cancel', 'comercial', 'Cancelar vendas', 4),
  ('stock.view', 'estoque', 'Ver estoque, movimentações e o painel do estoque', 1),
  ('stock.manage', 'estoque', 'Lançar entradas, saídas e ajustes de estoque', 3)
ON CONFLICT (key) DO NOTHING;

INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, g.key
  FROM controle_vendas_estoque.roles r
  JOIN (VALUES
    ('owner', 'sales.view'), ('owner', 'sales.create'), ('owner', 'sales.cancel'), ('owner', 'stock.view'), ('owner', 'stock.manage'),
    ('admin', 'sales.view'), ('admin', 'sales.create'), ('admin', 'sales.cancel'), ('admin', 'stock.view'), ('admin', 'stock.manage'),
    ('sales', 'sales.view'), ('sales', 'sales.create'), ('sales', 'stock.view'),
    ('finance', 'sales.view'), ('finance', 'stock.view'),
    ('stock', 'stock.view'), ('stock', 'stock.manage'),
    ('viewer', 'sales.view'), ('viewer', 'stock.view')
  ) AS g(role_key, key) ON g.role_key = r.key
 WHERE r.is_system
ON CONFLICT DO NOTHING;
