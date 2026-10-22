-- Nets no Telegram: um robô da plataforma (API oficial de bots). Cada pessoa
-- liga a própria conta pelo painel com um código de uso único; a partir daí
-- a Nets responde no Telegram com a empresa e as permissões dessa pessoa.
-- Tabelas globais (sem RLS), como users: o webhook chega sem empresa e
-- descobre a pessoa pelo id do Telegram.

CREATE TABLE controle_vendas_estoque.telegram_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  telegram_user_id  bigint NOT NULL,
  chat_id           bigint NOT NULL,
  username          text,
  first_name        text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- Uma conta do Telegram por pessoa, e cada conta do Telegram ligada a uma pessoa só.
CREATE UNIQUE INDEX telegram_links_user_key ON controle_vendas_estoque.telegram_links (user_id) WHERE status = 'active';
CREATE UNIQUE INDEX telegram_links_tg_key ON controle_vendas_estoque.telegram_links (telegram_user_id) WHERE status = 'active';
CREATE TRIGGER telegram_links_touch BEFORE UPDATE ON controle_vendas_estoque.telegram_links
  FOR EACH ROW EXECUTE FUNCTION controle_vendas_estoque.touch_updated_at();

-- Código do botão "Conectar": guardamos só o hash; vale uma vez, por 15 minutos.
CREATE TABLE controle_vendas_estoque.telegram_link_codes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  organization_id   uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  code_hash         bytea NOT NULL UNIQUE,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- O Telegram reenvia o que não recebeu resposta: cada update é tratado uma vez.
CREATE TABLE controle_vendas_estoque.telegram_updates (
  update_id         bigint PRIMARY KEY,
  received_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.telegram_links, controle_vendas_estoque.telegram_link_codes,
  controle_vendas_estoque.telegram_updates TO controle_vendas_estoque_app;

-- Resposta da Nets já entregue no Telegram (id da mensagem lá).
ALTER TABLE controle_vendas_estoque.nets_messages ADD COLUMN telegram_message_id bigint;
