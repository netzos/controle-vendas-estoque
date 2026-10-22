-- Fotos dos itens. Chegam já reduzidas (até 1600 px) e ficam no próprio banco,
-- protegidas pela mesma regra de empresa que o resto dos dados.

CREATE TABLE controle_vendas_estoque.product_images (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL,
  position          integer NOT NULL DEFAULT 0,
  content_type      text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data              bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 2097152),
  width             integer CHECK (width IS NULL OR width BETWEEN 1 AND 10000),
  height            integer CHECK (height IS NULL OR height BETWEEN 1 AND 10000),
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, product_id) REFERENCES controle_vendas_estoque.products (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX product_images_product_idx ON controle_vendas_estoque.product_images (organization_id, product_id, position);

ALTER TABLE controle_vendas_estoque.product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_images_tenant ON controle_vendas_estoque.product_images
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());

GRANT SELECT, INSERT, UPDATE, DELETE ON controle_vendas_estoque.product_images TO controle_vendas_estoque_app;
