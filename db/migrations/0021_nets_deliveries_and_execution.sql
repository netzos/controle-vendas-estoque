-- Netz: o texto exato entregue em cada canal (pedido nº 8) e as marcações
-- internas tiradas da resposta antes de guardar (pedido nº 7). Análise da IA
-- das melhorias: quando o administrador mandou executar as prioridades.

ALTER TABLE controle_vendas_estoque.nets_messages ADD COLUMN cleaned text[];

-- Uma linha por mensagem enviada a um canal de fora do painel (Telegram, e
-- depois WhatsApp), com o texto exatamente como foi enviado.
CREATE TABLE controle_vendas_estoque.nets_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  nets_message_id  uuid REFERENCES controle_vendas_estoque.nets_messages(id) ON DELETE CASCADE,
  channel          text NOT NULL CHECK (channel IN ('telegram', 'whatsapp')),
  text             text NOT NULL,
  status           text NOT NULL CHECK (status IN ('sent', 'failed')),
  error            text,
  removed          text[],
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nets_deliveries_person_idx ON controle_vendas_estoque.nets_deliveries (organization_id, user_id, created_at DESC);
ALTER TABLE controle_vendas_estoque.nets_deliveries ENABLE ROW LEVEL SECURITY;
-- Igual à conversa: só a própria pessoa, na empresa ativa.
CREATE POLICY nets_deliveries_owner ON controle_vendas_estoque.nets_deliveries
  USING (organization_id = controle_vendas_estoque.current_org() AND user_id = controle_vendas_estoque.current_user_id())
  WITH CHECK (organization_id = controle_vendas_estoque.current_org() AND user_id = controle_vendas_estoque.current_user_id());
GRANT SELECT, INSERT ON controle_vendas_estoque.nets_deliveries TO controle_vendas_estoque_app;

ALTER TABLE controle_vendas_estoque.improvement_analyses
  ADD COLUMN executed_at timestamptz,
  ADD COLUMN executed_by uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL;
GRANT UPDATE (executed_at, executed_by) ON controle_vendas_estoque.improvement_analyses TO controle_vendas_estoque_app;
