-- Custos do negócio e etapas depois da venda (entrega, instalação...). Cada empresa cria os seus tipos de custo; cada
-- lançamento pode ficar ligado a uma venda, entrega, produto ou fornecedor.
-- O custo de obtenção de um produto é a soma das suas partes, com histórico.

CREATE TABLE controle_vendas_estoque.cost_types (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX cost_types_name_key ON controle_vendas_estoque.cost_types (organization_id, lower(name));
CREATE TRIGGER cost_types_touch BEFORE UPDATE ON controle_vendas_estoque.cost_types
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

-- Depois da venda ----------------------------------------------------------------
-- A venda não termina no "vendido". O produto diz quais etapas vêm depois
-- (ex.: ar-condicionado = Entrega + Instalação). A venda ganha um
-- acompanhamento com endereço e uma linha por etapa, cada uma com prazo,
-- responsável, situação e custo.

ALTER TABLE controle_vendas_estoque.products
  ADD COLUMN after_sale_steps text[] NOT NULL DEFAULT '{}' CHECK (cardinality(after_sale_steps) <= 10);

CREATE TABLE controle_vendas_estoque.sale_followups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  sale_id           uuid NOT NULL UNIQUE REFERENCES controle_vendas_estoque.sales(id) ON DELETE CASCADE,
  address           text CHECK (address IS NULL OR length(btrim(address)) BETWEEN 3 AND 300),
  recipient         text CHECK (recipient IS NULL OR length(recipient) <= 120),
  phone             text CHECK (phone IS NULL OR length(phone) <= 30),
  notes             text CHECK (notes IS NULL OR length(notes) <= 500),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  done_at           timestamptz,
  created_by        uuid NOT NULL REFERENCES controle_vendas_estoque.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_followups_status_idx ON controle_vendas_estoque.sale_followups (organization_id, status);
CREATE TRIGGER sale_followups_touch BEFORE UPDATE ON controle_vendas_estoque.sale_followups
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

CREATE TABLE controle_vendas_estoque.sale_steps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  followup_id       uuid NOT NULL REFERENCES controle_vendas_estoque.sale_followups(id) ON DELETE CASCADE,
  sale_id           uuid NOT NULL REFERENCES controle_vendas_estoque.sales(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  position          integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
  scheduled_for     date,
  responsible       text CHECK (responsible IS NULL OR length(responsible) <= 120),
  notes             text CHECK (notes IS NULL OR length(notes) <= 500),
  done_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (followup_id, name)
);
CREATE INDEX sale_steps_open_idx ON controle_vendas_estoque.sale_steps (organization_id, status, scheduled_for);
CREATE TRIGGER sale_steps_touch BEFORE UPDATE ON controle_vendas_estoque.sale_steps
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

-- Taxa de entrega/serviço cobrada do cliente entra no total da venda.
ALTER TABLE controle_vendas_estoque.sales
  ADD COLUMN delivery_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0);
ALTER TABLE controle_vendas_estoque.sales DROP CONSTRAINT sales_check;
ALTER TABLE controle_vendas_estoque.sales ADD CONSTRAINT sales_check CHECK (total = subtotal - discount + delivery_fee);

-- Lançamentos de custo ---------------------------------------------------------

CREATE TABLE controle_vendas_estoque.costs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  cost_type_id      uuid NOT NULL,
  amount            numeric(14,2) NOT NULL CHECK (amount > 0),
  incurred_on       date NOT NULL,
  description       text CHECK (description IS NULL OR length(description) <= 300),
  sale_id           uuid REFERENCES controle_vendas_estoque.sales(id),
  step_id           uuid REFERENCES controle_vendas_estoque.sale_steps(id),
  product_id        uuid,
  supplier_id       uuid,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_at      timestamptz,
  created_by        uuid NOT NULL REFERENCES controle_vendas_estoque.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, cost_type_id) REFERENCES controle_vendas_estoque.cost_types (organization_id, id),
  FOREIGN KEY (organization_id, product_id) REFERENCES controle_vendas_estoque.products (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES controle_vendas_estoque.suppliers (organization_id, id)
);
CREATE INDEX costs_date_idx ON controle_vendas_estoque.costs (organization_id, incurred_on DESC) WHERE status = 'active';
CREATE UNIQUE INDEX costs_step_key ON controle_vendas_estoque.costs (step_id) WHERE step_id IS NOT NULL AND status = 'active';
CREATE TRIGGER costs_touch BEFORE UPDATE ON controle_vendas_estoque.costs
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

-- Custo de obtenção ------------------------------------------------------------
-- Partes do custo por unidade de um produto (ex.: lata de açaí = apanhador +
-- transporte). Cada mudança é uma linha nova com a data de início; o valor
-- vigente é o mais recente que já começou.

CREATE TABLE controle_vendas_estoque.product_cost_parts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL,
  cost_type_id      uuid NOT NULL,
  amount            numeric(14,4) NOT NULL CHECK (amount >= 0),
  valid_from        date NOT NULL,
  notes             text CHECK (notes IS NULL OR length(notes) <= 300),
  created_by        uuid NOT NULL REFERENCES controle_vendas_estoque.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, product_id, cost_type_id, valid_from),
  FOREIGN KEY (organization_id, product_id) REFERENCES controle_vendas_estoque.products (organization_id, id),
  FOREIGN KEY (organization_id, cost_type_id) REFERENCES controle_vendas_estoque.cost_types (organization_id, id)
);
CREATE INDEX product_cost_parts_product_idx ON controle_vendas_estoque.product_cost_parts (organization_id, product_id, valid_from DESC);

-- Segurança --------------------------------------------------------------------

ALTER TABLE controle_vendas_estoque.cost_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.sale_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.sale_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.product_cost_parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY cost_types_tenant ON controle_vendas_estoque.cost_types
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY sale_followups_tenant ON controle_vendas_estoque.sale_followups
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY sale_steps_tenant ON controle_vendas_estoque.sale_steps
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY costs_tenant ON controle_vendas_estoque.costs
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY product_cost_parts_tenant ON controle_vendas_estoque.product_cost_parts
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());

-- Custos são cancelados, não apagados. No custo de obtenção, cada data é uma
-- linha; lançar de novo na mesma data corrige o valor daquele dia.
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.cost_types, controle_vendas_estoque.sale_followups, controle_vendas_estoque.sale_steps,
  controle_vendas_estoque.costs, controle_vendas_estoque.product_cost_parts TO controle_vendas_estoque_app;

-- Tipos de custo iniciais para as empresas existentes (as novas recebem na criação).
INSERT INTO controle_vendas_estoque.cost_types (organization_id, name)
SELECT o.id, t.name
  FROM controle_vendas_estoque.organizations o
 CROSS JOIN (VALUES ('Entrega'), ('Instalação'), ('Montagem'), ('Mão de obra'), ('Frete de compra'), ('Embalagem'),
                    ('Taxa de cartão'), ('Comissão'), ('Combustível'), ('Outros')) AS t(name)
ON CONFLICT DO NOTHING;

INSERT INTO controle_vendas_estoque.permissions (key, module, description, risk_level) VALUES
  ('costs.view', 'custos', 'Ver custos, custo de obtenção e lucro real', 1),
  ('costs.manage', 'custos', 'Lançar e cancelar custos e mudar o custo de obtenção', 3),
  ('deliveries.view', 'entregas', 'Ver entregas e etapas depois da venda', 1),
  ('deliveries.manage', 'entregas', 'Gerir entregas e etapas depois da venda (prazo, responsável, situação, custo)', 2)
ON CONFLICT (key) DO NOTHING;

INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, g.key
  FROM controle_vendas_estoque.roles r
  JOIN (VALUES
    ('owner', 'costs.view'), ('owner', 'costs.manage'), ('owner', 'deliveries.view'), ('owner', 'deliveries.manage'),
    ('admin', 'costs.view'), ('admin', 'costs.manage'), ('admin', 'deliveries.view'), ('admin', 'deliveries.manage'),
    ('sales', 'deliveries.view'), ('sales', 'deliveries.manage'),
    ('finance', 'costs.view'), ('finance', 'costs.manage'), ('finance', 'deliveries.view'),
    ('stock', 'deliveries.view'), ('stock', 'deliveries.manage'),
    ('viewer', 'costs.view'), ('viewer', 'deliveries.view')
  ) AS g(role_key, key) ON g.role_key = r.key
 WHERE r.is_system
ON CONFLICT DO NOTHING;
