-- Comunicação da Netz, parte 2: o jeito de cada pessoa e a prova de leitura.
-- - nets_person_notes: o que a Netz aprende sobre como cada pessoa gosta de
--   conversar (mais ou menos organizada, se gosta de ser lembrada...). Uma
--   nota substituída ou removida continua guardada, desativada.
-- - nets_messages.guidance_version: a versão do manual que a Netz leu para
--   responder aquela mensagem (0 = texto padrão do código; NULL = antes desta
--   migração), no painel e no Telegram.

ALTER TABLE controle_vendas_estoque.nets_messages ADD COLUMN guidance_version bigint;

CREATE TABLE controle_vendas_estoque.nets_person_notes (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES controle_vendas_estoque.organizations(id) ON DELETE CASCADE,
  -- A pessoa de quem a nota fala (a mesma pessoa em outra empresa tem outras notas).
  user_id         uuid NOT NULL REFERENCES controle_vendas_estoque.users(id) ON DELETE CASCADE,
  body            text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 3 AND 500),
  -- netz: a Netz anotou na conversa. admin: o administrador da plataforma. person: a própria pessoa.
  source          text NOT NULL CHECK (source IN ('netz', 'admin', 'person')),
  -- Nota que esta substituiu (a antiga fica desativada).
  replaces        bigint REFERENCES controle_vendas_estoque.nets_person_notes(id) ON DELETE SET NULL,
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  ended_by        uuid REFERENCES controle_vendas_estoque.users(id) ON DELETE SET NULL,
  ended_reason    text CHECK (ended_reason IS NULL OR ended_reason IN ('replaced', 'removed'))
);
CREATE INDEX nets_person_notes_person_idx ON controle_vendas_estoque.nets_person_notes (organization_id, user_id, id DESC);
ALTER TABLE controle_vendas_estoque.nets_person_notes ENABLE ROW LEVEL SECURITY;
-- A própria pessoa (na empresa ativa, que é como a Netz roda) e o administrador da plataforma.
CREATE POLICY nets_person_notes_access ON controle_vendas_estoque.nets_person_notes
  USING (
    (organization_id = controle_vendas_estoque.current_org() AND user_id = controle_vendas_estoque.current_user_id())
    OR controle_vendas_estoque.is_platform_developer(controle_vendas_estoque.current_user_id()))
  WITH CHECK (
    (organization_id = controle_vendas_estoque.current_org() AND user_id = controle_vendas_estoque.current_user_id())
    OR controle_vendas_estoque.is_platform_developer(controle_vendas_estoque.current_user_id()));
GRANT SELECT, INSERT ON controle_vendas_estoque.nets_person_notes TO controle_vendas_estoque_app;
GRANT UPDATE (active, ended_at, ended_by, ended_reason) ON controle_vendas_estoque.nets_person_notes TO controle_vendas_estoque_app;
GRANT USAGE ON SEQUENCE controle_vendas_estoque.nets_person_notes_id_seq TO controle_vendas_estoque_app;

-- Pessoas de todas as empresas que já conversaram com a Netz, com as notas
-- ativas, para a Plataforma › Comunicação da Netz.
CREATE FUNCTION controle_vendas_estoque.platform_nets_people(p_user uuid)
RETURNS TABLE (organization_id uuid, organization_name text, user_id uuid, user_name text, messages integer,
               last_at timestamptz, telegram boolean, notes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  WITH talk AS (
    SELECT m.organization_id, m.user_id, count(*)::int AS messages, max(m.created_at) AS last_at,
           bool_or(m.channel = 'telegram') AS telegram
      FROM nets_messages m WHERE m.role = 'user' GROUP BY 1, 2
  ), noted AS (
    SELECT n.organization_id, n.user_id, count(*) FILTER (WHERE n.active)::int AS notes
      FROM nets_person_notes n GROUP BY 1, 2
  )
  SELECT p.organization_id, o.name, p.user_id, u.name, coalesce(t.messages, 0), t.last_at, coalesce(t.telegram, false), coalesce(n.notes, 0)
    FROM (SELECT organization_id, user_id FROM talk UNION SELECT organization_id, user_id FROM noted) p
    JOIN organizations o ON o.id = p.organization_id
    JOIN users u ON u.id = p.user_id
    LEFT JOIN talk t ON t.organization_id = p.organization_id AND t.user_id = p.user_id
    LEFT JOIN noted n ON n.organization_id = p.organization_id AND n.user_id = p.user_id
   WHERE is_platform_developer(p_user)
   ORDER BY t.last_at DESC NULLS LAST
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_nets_people(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_nets_people(uuid) TO controle_vendas_estoque_app;

-- Quantas respostas leram cada versão do manual, por canal (versão 0 = texto padrão).
CREATE FUNCTION controle_vendas_estoque.platform_nets_guidance_reads(p_user uuid)
RETURNS TABLE (version bigint, channel text, reads integer, last_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = controle_vendas_estoque, pg_temp AS $$
  SELECT m.guidance_version, coalesce(m.channel, 'web'), count(*)::int, max(m.updated_at)
    FROM nets_messages m
   WHERE is_platform_developer(p_user) AND m.guidance_version IS NOT NULL
   GROUP BY 1, 2
$$;
REVOKE ALL ON FUNCTION controle_vendas_estoque.platform_nets_guidance_reads(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION controle_vendas_estoque.platform_nets_guidance_reads(uuid) TO controle_vendas_estoque_app;
