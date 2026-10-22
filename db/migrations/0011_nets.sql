-- Nets: o agente global do sistema. Cada pessoa tem a própria conversa com a
-- Nets dentro de cada empresa. A Nets consulta à vontade, mas toda ação que
-- muda dados fica guardada como proposta até a pessoa confirmar.

CREATE TABLE controle_vendas_estoque.nets_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('user', 'assistant')),
  body              text NOT NULL CHECK (length(body) <= 20000),
  -- Tela em que a pessoa estava ao escrever (ex.: "Vendas · Venda nº 12").
  context           text CHECK (context IS NULL OR length(context) <= 200),
  channel           text NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'telegram', 'whatsapp')),
  -- queued/processing: a Nets ainda está respondendo.
  status            text NOT NULL DEFAULT 'done' CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  request_id        uuid,
  -- Ação proposta: { service, tool, input, title }.
  action            jsonb,
  action_status     text CHECK (action_status IN ('pending', 'running', 'done', 'failed', 'cancelled', 'expired')),
  action_result     text CHECK (action_result IS NULL OR length(action_result) <= 20000),
  action_decided_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((action IS NULL) = (action_status IS NULL))
);
CREATE INDEX nets_messages_conversation_idx ON controle_vendas_estoque.nets_messages (organization_id, user_id, created_at DESC);
CREATE UNIQUE INDEX nets_messages_request_key ON controle_vendas_estoque.nets_messages (user_id, request_id) WHERE request_id IS NOT NULL;
CREATE TRIGGER nets_messages_touch BEFORE UPDATE ON controle_vendas_estoque.nets_messages
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

ALTER TABLE controle_vendas_estoque.nets_messages ENABLE ROW LEVEL SECURITY;
-- Conversa privada: só a própria pessoa, na empresa ativa.
CREATE POLICY nets_messages_owner ON controle_vendas_estoque.nets_messages
  USING (organization_id = controle_vendas_estoque.current_org() AND user_id = controle_vendas_estoque.current_user_id())
  WITH CHECK (organization_id = controle_vendas_estoque.current_org() AND user_id = controle_vendas_estoque.current_user_id());

GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.nets_messages TO controle_vendas_estoque_app;

INSERT INTO controle_vendas_estoque.permissions (key, module, description, risk_level) VALUES
  ('nets.use', 'assistente', 'Conversar com a Nets, o agente do sistema (ela só faz o que a pessoa já pode fazer)', 1)
ON CONFLICT (key) DO NOTHING;

INSERT INTO controle_vendas_estoque.role_permissions (organization_id, role_id, permission_key)
SELECT r.organization_id, r.id, 'nets.use'
  FROM controle_vendas_estoque.roles r
 WHERE r.is_system AND r.key IN ('owner', 'admin', 'sales', 'finance', 'stock', 'viewer')
ON CONFLICT DO NOTHING;
