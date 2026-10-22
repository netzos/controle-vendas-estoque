-- Tipo do item e campos personalizados. O mesmo cadastro serve para quem
-- revende, produz, presta serviço ou vende sob encomenda.

-- stock: vende do estoque | made_to_order: vende sem estoque e pede depois
-- service: serviço, sem estoque | production: produção própria, com estoque
ALTER TABLE controle_vendas_estoque.products
  ADD COLUMN item_type text NOT NULL DEFAULT 'stock'
    CHECK (item_type IN ('stock', 'made_to_order', 'service', 'production')),
  ADD COLUMN custom_values jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(custom_values) = 'object');

UPDATE controle_vendas_estoque.products SET item_type = 'service' WHERE NOT track_stock;

-- Campos que cada empresa cria para os seus itens (IMEI, cor, safra...).
-- Com categoria, o campo só aparece nos itens daquela categoria.
CREATE TABLE controle_vendas_estoque.custom_fields (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  entity            text NOT NULL DEFAULT 'product' CHECK (entity IN ('product')),
  key               text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label             text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  field_type        text NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'select', 'boolean')),
  options           text[] NOT NULL DEFAULT '{}',
  category_id       uuid,
  required          boolean NOT NULL DEFAULT false,
  position          integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity, key),
  CHECK (field_type <> 'select' OR cardinality(options) BETWEEN 1 AND 50),
  FOREIGN KEY (organization_id, category_id) REFERENCES controle_vendas_estoque.categories (organization_id, id)
);
CREATE TRIGGER custom_fields_touch BEFORE UPDATE ON controle_vendas_estoque.custom_fields
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

ALTER TABLE controle_vendas_estoque.custom_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_fields_tenant ON controle_vendas_estoque.custom_fields
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());

-- Campos são desativados, não apagados: os valores antigos continuam nos itens.
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.custom_fields TO controle_vendas_estoque_app;

INSERT INTO controle_vendas_estoque.permissions (key, module, description, risk_level) VALUES
  ('custom_fields.manage', 'catalogo', 'Criar e alterar campos personalizados dos itens', 3)
ON CONFLICT (key) DO NOTHING;

INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, 'custom_fields.manage'
  FROM controle_vendas_estoque.roles r
 WHERE r.is_system AND r.key IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
