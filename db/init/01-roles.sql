-- Papéis do banco para desenvolvimento local (docker compose).
-- Em produção, crie o papel de login da aplicação com senha forte.
CREATE ROLE erp_app NOLOGIN;
CREATE ROLE erp_app_login LOGIN PASSWORD 'app' IN ROLE erp_app;
CREATE DATABASE erp_test OWNER erp_owner;
