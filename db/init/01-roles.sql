-- Papéis do banco para desenvolvimento local (docker compose).
-- Em produção, crie o papel de login da aplicação com senha forte.
CREATE ROLE controle_vendas_estoque_app NOLOGIN;
CREATE ROLE controle_vendas_estoque_app_login LOGIN PASSWORD 'app' IN ROLE controle_vendas_estoque_app;
CREATE DATABASE erp_test OWNER erp_owner;
