-- Melhoria 13: data combinada para o cliente retirar a venda (ou receber,
-- quando é entrega). A venda "a combinar" não precisa de mudança no banco.
ALTER TABLE controle_vendas_estoque.sales ADD COLUMN IF NOT EXISTS handover_date date;
CREATE INDEX IF NOT EXISTS sales_handover_date_idx
  ON controle_vendas_estoque.sales (organization_id, handover_date) WHERE handover_date IS NOT NULL;
