-- Fase 2: Cadastros.
-- Clientes, fornecedores, categorias, unidades de medida e produtos.
-- Valores monetários em numeric; nada passa por ponto flutuante.

CREATE TABLE controle_vendas_estoque.customers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  kind              text NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'company')),
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  document          text CHECK (document IS NULL OR document ~ '^[0-9]{11}$|^[0-9]{14}$'),
  email             text CHECK (email IS NULL OR email LIKE '%_@_%'),
  phone             text,
  city              text,
  state             char(2),
  notes             text CHECK (notes IS NULL OR length(notes) <= 2000),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX customers_document_key ON controle_vendas_estoque.customers (organization_id, document)
  WHERE document IS NOT NULL;
CREATE INDEX customers_name_idx ON controle_vendas_estoque.customers (organization_id, lower(name));
CREATE TRIGGER customers_touch BEFORE UPDATE ON controle_vendas_estoque.customers
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

CREATE TABLE controle_vendas_estoque.suppliers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  trade_name        text,
  document          text CHECK (document IS NULL OR document ~ '^[0-9]{11}$|^[0-9]{14}$'),
  email             text CHECK (email IS NULL OR email LIKE '%_@_%'),
  phone             text,
  contact_name      text,
  city              text,
  state             char(2),
  notes             text CHECK (notes IS NULL OR length(notes) <= 2000),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX suppliers_document_key ON controle_vendas_estoque.suppliers (organization_id, document)
  WHERE document IS NOT NULL;
CREATE INDEX suppliers_name_idx ON controle_vendas_estoque.suppliers (organization_id, lower(name));
CREATE TRIGGER suppliers_touch BEFORE UPDATE ON controle_vendas_estoque.suppliers
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

CREATE TABLE controle_vendas_estoque.categories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX categories_name_key ON controle_vendas_estoque.categories (organization_id, lower(name));
CREATE TRIGGER categories_touch BEFORE UPDATE ON controle_vendas_estoque.categories
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

CREATE TABLE controle_vendas_estoque.units (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,6}$'),
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 40),
  decimals          smallint NOT NULL DEFAULT 0 CHECK (decimals BETWEEN 0 AND 3),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);
CREATE TRIGGER units_touch BEFORE UPDATE ON controle_vendas_estoque.units
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

CREATE TABLE controle_vendas_estoque.products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  sku               text NOT NULL CHECK (sku ~ '^[A-Za-z0-9._/-]{1,40}$'),
  barcode           text CHECK (barcode IS NULL OR barcode ~ '^[0-9]{8,14}$'),
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  description       text CHECK (description IS NULL OR length(description) <= 2000),
  category_id       uuid,
  unit_id           uuid NOT NULL,
  supplier_id       uuid,
  sale_price        numeric(14,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  cost_price        numeric(14,4) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  min_stock         numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sku),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, category_id) REFERENCES controle_vendas_estoque.categories (organization_id, id),
  FOREIGN KEY (organization_id, unit_id) REFERENCES controle_vendas_estoque.units (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES controle_vendas_estoque.suppliers (organization_id, id)
);
CREATE UNIQUE INDEX products_barcode_key ON controle_vendas_estoque.products (organization_id, barcode)
  WHERE barcode IS NOT NULL;
CREATE INDEX products_name_idx ON controle_vendas_estoque.products (organization_id, lower(name));
CREATE TRIGGER products_touch BEFORE UPDATE ON controle_vendas_estoque.products
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

-- Row Level Security ---------------------------------------------------------

ALTER TABLE controle_vendas_estoque.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_tenant ON controle_vendas_estoque.customers
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY suppliers_tenant ON controle_vendas_estoque.suppliers
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY categories_tenant ON controle_vendas_estoque.categories
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY units_tenant ON controle_vendas_estoque.units
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
CREATE POLICY products_tenant ON controle_vendas_estoque.products
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());

-- Cadastros não são apagados: são desativados, para preservar o histórico.
GRANT SELECT, INSERT, UPDATE ON
  controle_vendas_estoque.customers, controle_vendas_estoque.suppliers, controle_vendas_estoque.categories,
  controle_vendas_estoque.units, controle_vendas_estoque.products
TO controle_vendas_estoque_app;

-- Unidades padrão para empresas já existentes (novas empresas recebem no cadastro).
INSERT INTO controle_vendas_estoque.units (organization_id, code, name, decimals)
SELECT o.id, u.code, u.name, u.decimals
  FROM controle_vendas_estoque.organizations o
 CROSS JOIN (VALUES ('UN', 'Unidade', 0), ('KG', 'Quilograma', 3), ('G', 'Grama', 0), ('L', 'Litro', 3),
                    ('ML', 'Mililitro', 0), ('CX', 'Caixa', 0), ('PCT', 'Pacote', 0), ('M', 'Metro', 2)) AS u(code, name, decimals)
ON CONFLICT DO NOTHING;

-- Permissões novas e concessão aos perfis padrão das empresas já existentes.
INSERT INTO controle_vendas_estoque.permissions (key, module, description, risk_level) VALUES
  ('customers.view', 'comercial', 'Ver clientes', 1),
  ('customers.manage', 'comercial', 'Cadastrar e alterar clientes', 2),
  ('suppliers.view', 'compras', 'Ver fornecedores', 1),
  ('suppliers.manage', 'compras', 'Cadastrar e alterar fornecedores', 2),
  ('products.view', 'catalogo', 'Ver produtos, categorias e unidades', 1),
  ('products.manage', 'catalogo', 'Cadastrar e alterar produtos, categorias e unidades', 2),
  ('products.update_price', 'catalogo', 'Alterar preço de venda e custo', 3)
ON CONFLICT (key) DO NOTHING;

INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, g.key
  FROM controle_vendas_estoque.roles r
  JOIN (VALUES
    ('owner', 'customers.view'), ('owner', 'customers.manage'), ('owner', 'suppliers.view'), ('owner', 'suppliers.manage'),
    ('owner', 'products.view'), ('owner', 'products.manage'), ('owner', 'products.update_price'),
    ('admin', 'customers.view'), ('admin', 'customers.manage'), ('admin', 'suppliers.view'), ('admin', 'suppliers.manage'),
    ('admin', 'products.view'), ('admin', 'products.manage'), ('admin', 'products.update_price'),
    ('sales', 'customers.view'), ('sales', 'customers.manage'), ('sales', 'products.view'),
    ('finance', 'customers.view'), ('finance', 'suppliers.view'), ('finance', 'products.view'),
    ('stock', 'suppliers.view'), ('stock', 'suppliers.manage'), ('stock', 'products.view'), ('stock', 'products.manage'),
    ('viewer', 'customers.view'), ('viewer', 'suppliers.view'), ('viewer', 'products.view')
  ) AS g(role_key, key) ON g.role_key = r.key
 WHERE r.is_system
ON CONFLICT DO NOTHING;
