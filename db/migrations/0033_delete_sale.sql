-- Excluir uma venda por completo (sales.delete): a venda some com itens,
-- pagamentos, troca, etapas e custos ligados a ela, e os movimentos de estoque
-- que ela gerou são desfeitos e apagados. Itens, pagamentos, trocas e etapas já
-- saem em cascata; custos e movimentos são apagados pelo serviço.
GRANT DELETE ON
  controle_vendas_estoque.sales,
  controle_vendas_estoque.sale_items,
  controle_vendas_estoque.sale_payments,
  controle_vendas_estoque.sale_trade_ins,
  controle_vendas_estoque.sale_followups,
  controle_vendas_estoque.sale_steps,
  controle_vendas_estoque.stock_movements,
  controle_vendas_estoque.costs
TO controle_vendas_estoque_app;
