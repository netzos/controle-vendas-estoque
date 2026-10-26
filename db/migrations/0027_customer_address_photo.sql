-- Cliente com endereço completo (começa pelo CEP, que preenche rua, bairro,
-- cidade e UF) e foto opcional. Mesmas regras do endereço do fornecedor.
-- A foto fica na própria linha; photo_id muda a cada foto nova, para o
-- navegador nunca mostrar a antiga.
ALTER TABLE controle_vendas_estoque.customers
  ADD COLUMN zip_code      text CHECK (zip_code IS NULL OR zip_code ~ '^[0-9]{8}$'),
  ADD COLUMN street        text CHECK (street IS NULL OR length(street) <= 160),
  ADD COLUMN street_number text CHECK (street_number IS NULL OR length(street_number) <= 20),
  ADD COLUMN complement    text CHECK (complement IS NULL OR length(complement) <= 80),
  ADD COLUMN district      text CHECK (district IS NULL OR length(district) <= 80),
  ADD COLUMN photo_id      uuid,
  ADD COLUMN photo_type    text CHECK (photo_type IS NULL OR photo_type IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD COLUMN photo         bytea CHECK (photo IS NULL OR octet_length(photo) <= 2097152);
