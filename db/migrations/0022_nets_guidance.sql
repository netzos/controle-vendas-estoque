-- Comunicação da Netz: o manual de como a Netz conversa fica no banco, com
-- uma versão por alteração (nada é apagado), e os pedidos de ajuste na
-- comunicação ganham um módulo próprio, separado das melhorias do sistema.
-- Mesmo desenho das instruções da IA do IONPA (ai_guidance) e do AGENTS.md do
-- NetzOS.

ALTER TABLE controle_vendas_estoque.improvements DROP CONSTRAINT improvements_module_check;
ALTER TABLE controle_vendas_estoque.improvements ADD CONSTRAINT improvements_module_check CHECK (module IN (
  'geral', 'comercial', 'catalogo', 'estoque', 'compras', 'financeiro',
  'inteligencia', 'assistente', 'automacoes', 'administracao', 'comunicacao'));

-- A versão mais nova é a que a Netz lê antes de cada resposta. Sem nenhuma
-- linha, vale o texto padrão do código.
CREATE TABLE controle_vendas_estoque.nets_guidance (
  id              bigserial PRIMARY KEY,
  body            text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 20000),
  -- O que mudou, em uma frase (aparece no histórico).
  note            text CHECK (note IS NULL OR char_length(note) <= 300),
  source          text NOT NULL CHECK (source IN ('edit', 'proposal', 'revert')),
  -- Pedido de ajuste (módulo comunicacao) que originou a mudança.
  improvement_id  uuid REFERENCES controle_vendas_estoque.improvements(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  created_by_name text NOT NULL CHECK (char_length(created_by_name) BETWEEN 1 AND 120),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE controle_vendas_estoque.nets_guidance ENABLE ROW LEVEL SECURITY;
-- Vale para todas as empresas: qualquer conversa lê; só o administrador da
-- plataforma grava.
CREATE POLICY nets_guidance_read ON controle_vendas_estoque.nets_guidance FOR SELECT USING (true);
CREATE POLICY nets_guidance_write ON controle_vendas_estoque.nets_guidance FOR INSERT
  WITH CHECK (controle_vendas_estoque.is_platform_developer(controle_vendas_estoque.current_user_id()));
GRANT SELECT, INSERT ON controle_vendas_estoque.nets_guidance TO controle_vendas_estoque_app;
GRANT USAGE ON SEQUENCE controle_vendas_estoque.nets_guidance_id_seq TO controle_vendas_estoque_app;
