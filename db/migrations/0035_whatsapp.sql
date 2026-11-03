-- Netz no WhatsApp por QR Code (ponte GOWA, a mesma do NetzOS). Um número da
-- plataforma atende todo mundo, como o robô do Telegram; cada pessoa liga a
-- própria conta pelo painel com um código de uso único que vai escrito na
-- conversa (wa.me/numero?text=...). Tabelas globais (sem RLS), como as do
-- Telegram: o aviso da ponte chega sem empresa e acha a pessoa pelo número.

CREATE TABLE controle_vendas_estoque.whatsapp_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  -- Conversa da pessoa (5591999999999@s.whatsapp.net) e o número só com dígitos.
  jid               text NOT NULL,
  phone             text NOT NULL,
  push_name         text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- Um WhatsApp por pessoa, e cada número ligado a uma pessoa só.
CREATE UNIQUE INDEX whatsapp_links_user_key ON controle_vendas_estoque.whatsapp_links (user_id) WHERE status = 'active';
CREATE UNIQUE INDEX whatsapp_links_jid_key ON controle_vendas_estoque.whatsapp_links (jid) WHERE status = 'active';
CREATE TRIGGER whatsapp_links_touch BEFORE UPDATE ON controle_vendas_estoque.whatsapp_links
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

-- Código do botão "WhatsApp": guardamos só o hash; vale uma vez.
CREATE TABLE controle_vendas_estoque.whatsapp_link_codes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  code_hash         bytea NOT NULL UNIQUE,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- A ponte pode avisar a mesma mensagem duas vezes: cada uma é tratada uma vez só.
CREATE TABLE controle_vendas_estoque.whatsapp_events (
  message_id        text PRIMARY KEY,
  received_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.whatsapp_links, controle_vendas_estoque.whatsapp_link_codes,
  controle_vendas_estoque.whatsapp_events TO controle_vendas_estoque_app;

-- Resposta da Netz já entregue no WhatsApp.
ALTER TABLE controle_vendas_estoque.nets_messages ADD COLUMN whatsapp_sent_at timestamptz;
