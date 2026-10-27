-- Venda parcelada e contas a receber ("dinheiro na rua").
-- Uma venda pode ter entrada (o que foi pago na hora, em sale_payments) e o
-- restante dividido em parcelas com vencimento. Cada recebimento continua sendo
-- uma linha em sale_payments e é aplicado nas parcelas, da mais antiga para a
-- mais nova. A situação "vencida" e "parcial" é calculada na consulta:
--   open + vencimento passado = vencida; open + paid_amount > 0 = parcial.
ALTER TABLE controle_vendas_estoque.sales
  ADD COLUMN down_payment         numeric(14,2) NOT NULL DEFAULT 0 CHECK (down_payment >= 0),
  ADD COLUMN installment_count    int NOT NULL DEFAULT 0 CHECK (installment_count BETWEEN 0 AND 120),
  ADD COLUMN installment_interval text CHECK (installment_interval IS NULL OR installment_interval IN ('monthly', 'biweekly', 'weekly', 'single')),
  ADD COLUMN first_due_date       date;

CREATE TABLE controle_vendas_estoque.sale_installments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  sale_id          uuid NOT NULL,
  number           int NOT NULL CHECK (number >= 1),
  due_date         date NOT NULL,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_amount      numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0 AND paid_amount <= amount),
  -- Dia do último recebimento aplicado nesta parcela.
  paid_on          date,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  notes            text CHECK (notes IS NULL OR length(notes) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, number),
  FOREIGN KEY (organization_id, sale_id) REFERENCES controle_vendas_estoque.sales (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX sale_installments_sale_idx ON controle_vendas_estoque.sale_installments (organization_id, sale_id, number);
CREATE INDEX sale_installments_due_idx ON controle_vendas_estoque.sale_installments (organization_id, due_date) WHERE status = 'open';
ALTER TABLE controle_vendas_estoque.sale_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_installments_tenant ON controle_vendas_estoque.sale_installments
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.sale_installments TO controle_vendas_estoque_app;

-- Importação de dados de outro sistema (planilhas CSV): o código que a linha
-- tinha lá, para ligar vendas, itens, pagamentos e parcelas sem duplicar.
ALTER TABLE controle_vendas_estoque.customers ADD COLUMN import_ref text CHECK (import_ref IS NULL OR length(import_ref) <= 100);
ALTER TABLE controle_vendas_estoque.suppliers ADD COLUMN import_ref text CHECK (import_ref IS NULL OR length(import_ref) <= 100);
ALTER TABLE controle_vendas_estoque.products  ADD COLUMN import_ref text CHECK (import_ref IS NULL OR length(import_ref) <= 100);
ALTER TABLE controle_vendas_estoque.sales     ADD COLUMN import_ref text CHECK (import_ref IS NULL OR length(import_ref) <= 100);
CREATE UNIQUE INDEX customers_import_ref_key ON controle_vendas_estoque.customers (organization_id, import_ref) WHERE import_ref IS NOT NULL;
CREATE UNIQUE INDEX suppliers_import_ref_key ON controle_vendas_estoque.suppliers (organization_id, import_ref) WHERE import_ref IS NOT NULL;
CREATE UNIQUE INDEX products_import_ref_key  ON controle_vendas_estoque.products  (organization_id, import_ref) WHERE import_ref IS NOT NULL;
CREATE UNIQUE INDEX sales_import_ref_key     ON controle_vendas_estoque.sales     (organization_id, import_ref) WHERE import_ref IS NOT NULL;

-- Compras de mercadoria (o que foi comprado de quem, por quanto e se já foi
-- pago). Base para "A pagar"; por enquanto recebe as compras importadas.
CREATE TABLE controle_vendas_estoque.purchases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  supplier_id      uuid,
  product_id       uuid,
  description      text CHECK (description IS NULL OR length(description) <= 300),
  quantity         numeric(14,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost        numeric(14,4) NOT NULL CHECK (unit_cost >= 0),
  total            numeric(14,2) NOT NULL CHECK (total >= 0),
  purchased_on     date NOT NULL,
  paid_total       numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  payment_status   text NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'partial', 'pending')),
  due_date         date,
  notes            text CHECK (notes IS NULL OR length(notes) <= 1000),
  import_ref       text CHECK (import_ref IS NULL OR length(import_ref) <= 100),
  created_by       uuid NOT NULL REFERENCES controle_vendas_estoque.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES controle_vendas_estoque.suppliers (organization_id, id),
  FOREIGN KEY (organization_id, product_id) REFERENCES controle_vendas_estoque.products (organization_id, id)
);
CREATE INDEX purchases_date_idx ON controle_vendas_estoque.purchases (organization_id, purchased_on DESC);
CREATE UNIQUE INDEX purchases_import_ref_key ON controle_vendas_estoque.purchases (organization_id, import_ref) WHERE import_ref IS NOT NULL;
ALTER TABLE controle_vendas_estoque.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchases_tenant ON controle_vendas_estoque.purchases
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.purchases TO controle_vendas_estoque_app;
