-- Comprovantes da venda: foto do cupom, print do Pix ou PDF, ligados à venda
-- (e, se for o caso, a uma parcela). Ficam no próprio banco, com a mesma regra
-- de empresa do resto dos dados, como as fotos dos itens.
-- sale_id vazio = chegou pela Netz e ainda espera a pessoa confirmar a venda.
-- check_*: a conferência automática (a IA lê o comprovante e compara com a venda).
CREATE TABLE controle_vendas_estoque.sale_attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  sale_id          uuid,
  installment_id   uuid REFERENCES controle_vendas_estoque.sale_installments(id) ON DELETE SET NULL,
  content_type     text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  file_name        text CHECK (file_name IS NULL OR length(file_name) <= 160),
  data             bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 4194304),
  source           text NOT NULL DEFAULT 'panel' CHECK (source IN ('panel', 'netz', 'telegram', 'whatsapp')),
  notes            text CHECK (notes IS NULL OR length(notes) <= 300),
  check_status     text CHECK (check_status IS NULL OR check_status IN ('pending', 'match', 'mismatch', 'unreadable', 'failed')),
  check_amount     numeric(14,2),
  check_date       date,
  check_method     text CHECK (check_method IS NULL OR length(check_method) <= 40),
  check_note       text CHECK (check_note IS NULL OR length(check_note) <= 500),
  checked_at       timestamptz,
  linked_at        timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, sale_id) REFERENCES controle_vendas_estoque.sales (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX sale_attachments_sale_idx ON controle_vendas_estoque.sale_attachments (organization_id, sale_id, created_at);
CREATE INDEX sale_attachments_check_idx ON controle_vendas_estoque.sale_attachments (organization_id) WHERE check_status = 'pending';

ALTER TABLE controle_vendas_estoque.sale_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY sale_attachments_tenant ON controle_vendas_estoque.sale_attachments
  USING (organization_id = controle_vendas_estoque.current_org()) WITH CHECK (organization_id = controle_vendas_estoque.current_org());
GRANT SELECT, INSERT, UPDATE, DELETE ON controle_vendas_estoque.sale_attachments TO controle_vendas_estoque_app;

-- Mensagem da conversa com a Netz que trouxe um comprovante.
ALTER TABLE controle_vendas_estoque.nets_messages ADD COLUMN attachment_id uuid;
