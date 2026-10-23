-- Quem já tem conta pede outra empresa pelo painel (Criar outra empresa): o
-- pedido passa pela mesma aprovação, mas a empresa nova entra na conta que já
-- existe, com o mesmo e-mail e a mesma senha.
ALTER TABLE controle_vendas_estoque.signup_requests
  ADD COLUMN requested_by uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD CONSTRAINT signup_requests_password_or_user CHECK (password_hash IS NOT NULL OR requested_by IS NOT NULL);
