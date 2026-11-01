-- Melhoria 13: venda com pagamento "a combinar" e data de retirada/entrega.
-- payment_method fica vazio enquanto a forma não foi combinada; o primeiro
-- recebimento preenche. handover_date é o dia combinado para o cliente
-- retirar (ou receber, quando é entrega).
ALTER TABLE controle_vendas_estoque.sales ALTER COLUMN payment_method DROP NOT NULL;
ALTER TABLE controle_vendas_estoque.sales ADD COLUMN IF NOT EXISTS handover_date date;
CREATE INDEX IF NOT EXISTS sales_handover_date_idx
  ON controle_vendas_estoque.sales (organization_id, handover_date) WHERE handover_date IS NOT NULL;
