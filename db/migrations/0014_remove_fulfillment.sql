-- Excluir cadastros: sem histórico apaga de verdade; com histórico, o serviço desativa.
GRANT DELETE ON controle_vendas_estoque.products, controle_vendas_estoque.categories, controle_vendas_estoque.units,
  controle_vendas_estoque.customers, controle_vendas_estoque.suppliers, controle_vendas_estoque.cost_types,
  controle_vendas_estoque.step_types, controle_vendas_estoque.custom_fields, controle_vendas_estoque.product_cost_parts
  TO controle_vendas_estoque_app;

-- Como a venda chega ao cliente: retirada no local ou entrega.
ALTER TABLE controle_vendas_estoque.sales
  ADD COLUMN fulfillment text NOT NULL DEFAULT 'pickup' CHECK (fulfillment IN ('pickup', 'delivery'));

UPDATE controle_vendas_estoque.sales s SET fulfillment = 'delivery'
 WHERE s.delivery_fee > 0
    OR EXISTS (SELECT 1 FROM controle_vendas_estoque.sale_followups f WHERE f.sale_id = s.id AND f.address IS NOT NULL)
    OR EXISTS (SELECT 1 FROM controle_vendas_estoque.sale_steps t WHERE t.sale_id = s.id AND lower(t.name) = 'entrega');

-- O nome da assistente passa a ser escrito com Z, como o do sistema.
UPDATE controle_vendas_estoque.permissions
   SET description = 'Conversar com a Netz, o agente do sistema (ela só faz o que a pessoa já pode fazer)'
 WHERE key = 'nets.use';
