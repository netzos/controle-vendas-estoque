-- Encomenda quando acaba e etapas configuráveis por empresa.
--
-- 1. Um produto de estoque pode também ser vendido por encomenda quando o
--    estoque acaba (backorder). O saldo fica negativo: -2 = 2 unidades
--    vendidas que ainda precisam chegar. A venda ganha a etapa "Encomenda".
-- 2. As etapas depois da venda (Entrega, Montagem...) são uma lista de cada
--    empresa, com prazo, responsável e custo padrão.

ALTER TABLE controle_vendas_estoque.products
  ADD COLUMN backorder boolean NOT NULL DEFAULT true;

ALTER TABLE controle_vendas_estoque.sale_items
  ADD COLUMN backorder_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (backorder_qty >= 0);

CREATE TABLE controle_vendas_estoque.step_types (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  name                text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  description         text CHECK (description IS NULL OR length(description) <= 300),
  default_days        integer CHECK (default_days IS NULL OR default_days BETWEEN 0 AND 365),
  default_responsible text CHECK (default_responsible IS NULL OR length(default_responsible) <= 120),
  default_cost        numeric(14,2) CHECK (default_cost IS NULL OR default_cost >= 0),
  position            integer NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX step_types_name_key ON controle_vendas_estoque.step_types (organization_id, lower(name));
CREATE TRIGGER step_types_touch BEFORE UPDATE ON controle_vendas_estoque.step_types
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

ALTER TABLE controle_vendas_estoque.step_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY step_types_tenant ON controle_vendas_estoque.step_types
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.step_types TO controle_vendas_estoque_app;

-- Lista inicial das empresas existentes, mais as etapas que elas já usam nos produtos.
INSERT INTO controle_vendas_estoque.step_types (organization_id, name, description, position)
SELECT o.id, t.name, t.description, t.position
  FROM controle_vendas_estoque.organizations o
 CROSS JOIN (VALUES
   ('Encomenda', 'Pedir ao fornecedor ou produzir o que foi vendido sem estoque.', 0),
   ('Entrega', 'Levar até o cliente.', 1),
   ('Instalação', 'Instalar no local do cliente.', 2),
   ('Montagem', 'Montar no local do cliente.', 3),
   ('Retirada na loja', 'O cliente busca na loja.', 4),
   ('Ajuste', 'Ajuste ou acerto depois da venda.', 5),
   ('Personalização', 'Gravação, pintura ou outro acabamento sob pedido.', 6)
 ) AS t(name, description, position)
ON CONFLICT DO NOTHING;

INSERT INTO controle_vendas_estoque.step_types (organization_id, name, position)
SELECT DISTINCT p.organization_id, s.name, 100
  FROM controle_vendas_estoque.products p, unnest(p.after_sale_steps) AS s(name)
ON CONFLICT DO NOTHING;
