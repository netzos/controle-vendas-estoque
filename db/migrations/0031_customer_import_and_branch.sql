-- Pedido nº 9: código próprio do cliente e data de cadastro original, para
-- importar a base de clientes de uma planilha.
-- Pedido nº 10: cliente e venda ligados a uma filial (opcional). Sem filial,
-- vale para a empresa toda, como antes.

ALTER TABLE controle_vendas_estoque.customers
  ADD COLUMN code text CHECK (code IS NULL OR length(btrim(code)) BETWEEN 1 AND 40),
  ADD COLUMN customer_since date,
  ADD COLUMN branch_id uuid,
  ADD CONSTRAINT customers_branch_fk FOREIGN KEY (organization_id, branch_id)
    REFERENCES controle_vendas_estoque.branches (organization_id, id);
CREATE INDEX customers_code_idx ON controle_vendas_estoque.customers (organization_id, lower(code)) WHERE code IS NOT NULL;
CREATE INDEX customers_branch_idx ON controle_vendas_estoque.customers (organization_id, branch_id) WHERE branch_id IS NOT NULL;

ALTER TABLE controle_vendas_estoque.sales
  ADD COLUMN branch_id uuid,
  ADD CONSTRAINT sales_branch_fk FOREIGN KEY (organization_id, branch_id)
    REFERENCES controle_vendas_estoque.branches (organization_id, id);
CREATE INDEX sales_branch_idx ON controle_vendas_estoque.sales (organization_id, branch_id, sold_at) WHERE branch_id IS NOT NULL;
