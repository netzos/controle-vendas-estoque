-- Melhorias: pedidos de mudança no próprio ERP, cada um com sua conversa.
-- Mesmo fluxo do NetzOS e do IONPA: pedido → análise do Claude → decisão do
-- desenvolvedor → desenvolvimento → publicação. Só desenvolvedores da
-- plataforma (controle_vendas_estoque.platform_developers) aprovam ou recusam; nada é construído
-- sem aprovação. Pedidos não devem conter dados pessoais de clientes.

-- Desenvolvedores da plataforma. Incluídos apenas pelo dono do banco
-- (pnpm platform:developer add <email>); a aplicação não tem acesso direto.
CREATE TABLE controle_vendas_estoque.platform_developers (
  user_id   uuid PRIMARY KEY REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON controle_vendas_estoque.platform_developers FROM PUBLIC;

CREATE FUNCTION controle_vendas_estoque.is_platform_developer(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM controle_vendas_estoque.platform_developers d
      JOIN controle_vendas_estoque.users u ON u.id = d.user_id
     WHERE d.user_id = p_user AND u.status = 'active'
  )
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.is_platform_developer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.is_platform_developer(uuid) TO controle_vendas_estoque_app;

-- Ator de plataforma da transação ('claude' na rota e no comando do Claude).
CREATE FUNCTION controle_vendas_estoque.current_platform_actor() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.platform_actor', true), '')
$$;

CREATE TABLE controle_vendas_estoque.improvements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number            bigserial UNIQUE,
  -- Empresa de quem pediu. NULL para pedidos do Claude.
  organization_id   uuid REFERENCES controle_vendas_estoque.organizations(id) ON DELETE SET NULL,
  -- Nome da empresa no momento do pedido: o desenvolvedor vê pedidos de todas
  -- as empresas sem precisar de acesso aos dados delas.
  organization_name text,
  title             text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 200),
  body              text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  module            text NOT NULL DEFAULT 'geral' CHECK (module IN (
                      'geral', 'comercial', 'catalogo', 'estoque', 'compras', 'financeiro',
                      'inteligencia', 'assistente', 'automacoes', 'administracao')),
  status            text NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'analysis', 'approved', 'building', 'published', 'rejected')),
  source            text NOT NULL CHECK (source IN ('site', 'telegram', 'erp_ai', 'claude')),
  -- Partes do pedido: fala_original, problema, proposta, criterios.
  details           jsonb CHECK (details IS NULL OR jsonb_typeof(details) = 'object'),
  created_by        uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  created_by_name   text NOT NULL CHECK (char_length(created_by_name) BETWEEN 1 AND 120),
  decided_by        uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  decided_by_name   text,
  decided_at        timestamptz,
  link              text CHECK (link IS NULL OR (link LIKE 'https://%' AND char_length(link) <= 500)),
  version           integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX improvements_updated_idx ON controle_vendas_estoque.improvements (updated_at DESC);
CREATE INDEX improvements_org_idx ON controle_vendas_estoque.improvements (organization_id, updated_at DESC);
CREATE INDEX improvements_open_title_idx ON controle_vendas_estoque.improvements (lower(title))
  WHERE status IN ('new', 'analysis', 'approved', 'building');

CREATE TABLE controle_vendas_estoque.improvement_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  improvement_id  uuid NOT NULL REFERENCES controle_vendas_estoque.improvements(id) ON DELETE CASCADE,
  author_kind     text NOT NULL CHECK (author_kind IN ('person', 'erp_ai', 'claude')),
  author_id       uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  author_name     text NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 120),
  body            text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX improvement_messages_thread_idx ON controle_vendas_estoque.improvement_messages (improvement_id, created_at);

-- Membros veem os pedidos da própria empresa; desenvolvedores e o Claude veem todos.
ALTER TABLE controle_vendas_estoque.improvements ENABLE ROW LEVEL SECURITY;
ALTER TABLE controle_vendas_estoque.improvement_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY improvements_access ON controle_vendas_estoque.improvements
  USING (
    organization_id = controle_vendas_estoque.current_org()
    OR controle_vendas_estoque.current_platform_actor() = 'claude'
    OR controle_vendas_estoque.is_platform_developer(controle_vendas_estoque.current_user_id())
  )
  WITH CHECK (
    organization_id = controle_vendas_estoque.current_org()
    OR controle_vendas_estoque.current_platform_actor() = 'claude'
    OR controle_vendas_estoque.is_platform_developer(controle_vendas_estoque.current_user_id())
  );

CREATE POLICY improvement_messages_access ON controle_vendas_estoque.improvement_messages
  USING (EXISTS (SELECT 1 FROM controle_vendas_estoque.improvements i WHERE i.id = improvement_id))
  WITH CHECK (EXISTS (SELECT 1 FROM controle_vendas_estoque.improvements i WHERE i.id = improvement_id));

GRANT SELECT, INSERT, UPDATE ON controle_vendas_estoque.improvements TO controle_vendas_estoque_app;
GRANT SELECT, INSERT ON controle_vendas_estoque.improvement_messages TO controle_vendas_estoque_app;
GRANT USAGE ON SEQUENCE controle_vendas_estoque.improvements_number_seq TO controle_vendas_estoque_app;
