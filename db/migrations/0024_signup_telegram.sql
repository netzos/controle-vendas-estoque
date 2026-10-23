-- Telegram logo no pedido de conta: a tela de "pedido recebido" traz o link do
-- robô (t.me/robo?start=c_código). A pessoa toca, o robô reconhece o pedido em
-- análise, e na aprovação a conta já nasce ligada a esse Telegram.
ALTER TABLE controle_vendas_estoque.signup_requests
  ADD COLUMN telegram_code_hash  bytea UNIQUE,
  ADD COLUMN telegram_user_id    bigint,
  ADD COLUMN telegram_chat_id    bigint,
  ADD COLUMN telegram_username   text,
  ADD COLUMN telegram_first_name text;
CREATE INDEX signup_requests_telegram_idx ON controle_vendas_estoque.signup_requests (telegram_user_id) WHERE telegram_user_id IS NOT NULL;
