-- Fornecedor completo: WhatsApp, endereço, prazo de entrega e preço combinado
-- por produto. Serve para pedir ao fornecedor o que foi vendido sob encomenda.

ALTER TABLE controle_vendas_estoque.suppliers
  ADD COLUMN whatsapp          text CHECK (whatsapp IS NULL OR whatsapp ~ '^[0-9]{10,13}$'),
  ADD COLUMN zip_code          text CHECK (zip_code IS NULL OR zip_code ~ '^[0-9]{8}$'),
  ADD COLUMN street            text CHECK (street IS NULL OR length(street) <= 160),
  ADD COLUMN street_number     text CHECK (street_number IS NULL OR length(street_number) <= 20),
  ADD COLUMN complement        text CHECK (complement IS NULL OR length(complement) <= 80),
  ADD COLUMN district          text CHECK (district IS NULL OR length(district) <= 80),
  ADD COLUMN lead_time_days    integer CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365);

-- Um produto pode ter vários fornecedores, cada um com o seu preço combinado.
CREATE TABLE controle_vendas_estoque.supplier_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  supplier_id       uuid NOT NULL,
  product_id        uuid NOT NULL,
  agreed_price      numeric(14,4) NOT NULL CHECK (agreed_price >= 0),
  supplier_code     text CHECK (supplier_code IS NULL OR length(supplier_code) <= 60),
  lead_time_days    integer CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365),
  notes             text CHECK (notes IS NULL OR length(notes) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, supplier_id, product_id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES controle_vendas_estoque.suppliers (organization_id, id),
  FOREIGN KEY (organization_id, product_id) REFERENCES controle_vendas_estoque.products (organization_id, id)
);
CREATE INDEX supplier_products_product_idx ON controle_vendas_estoque.supplier_products (organization_id, product_id);
CREATE TRIGGER supplier_products_touch BEFORE UPDATE ON controle_vendas_estoque.supplier_products
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

ALTER TABLE controle_vendas_estoque.supplier_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_products_tenant ON controle_vendas_estoque.supplier_products
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());

-- O vínculo pode ser desfeito; a auditoria guarda o preço que existia.
GRANT SELECT, INSERT, UPDATE, DELETE ON controle_vendas_estoque.supplier_products TO controle_vendas_estoque_app;

-- Mudar o preço na hora da venda é um poder que o dono concede por perfil.
INSERT INTO controle_vendas_estoque.permissions (key, module, description, risk_level) VALUES
  ('sales.change_price', 'comercial', 'Mudar o preço de um item na hora da venda', 3)
ON CONFLICT (key) DO NOTHING;

INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, 'sales.change_price'
  FROM controle_vendas_estoque.roles r
 WHERE r.is_system AND r.key IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
