# Ponte NetzOS → netzsales

De dentro do NetzOS publicado (netzos.app) o dono vê o que acontece no netzsales e dá ordens, sem abrir o netzsales.
A conversa é de servidor para servidor: o servidor do NetzOS (Core) chama o netzsales com uma senha comprida (token).
O navegador nunca vê o token.

## Configuração

| Onde | Variável | Valor |
| --- | --- | --- |
| Vercel (netzsales) | `NETZOS_BRIDGE_TOKEN` | senha comprida (64 letras/números), a mesma do NetzOS |
| Vercel (netzsales) | `NETZOS_BRIDGE_EMAIL` | opcional; padrão `acesso@netzcode.com.br` |
| Servidor do NetzOS (`deploy/.env`) | `NETZSALES_BRIDGE_URL` | `https://netzsales.vercel.app` |
| Servidor do NetzOS (`deploy/.env`) | `NETZSALES_BRIDGE_TOKEN` | o mesmo valor de `NETZOS_BRIDGE_TOKEN` |

Sem o token (ou com menos de 32 caracteres) a ponte fica fechada e responde 401.
Tudo é feito em nome do administrador da plataforma (`NETZOS_BRIDGE_EMAIL`), com as mesmas regras do painel; se a conta
deixar de ser administradora, a ponte responde 503.

## Rotas

Todas pedem `Authorization: Bearer <token>`.

- `GET /api/netzos/resumo`: o retrato do Painel da plataforma numa chamada (empresas, pessoas, cadastros, uso, dinheiro,
  números por mês, lista das empresas clientes com saúde e vendas de 30 dias, pedidos de melhoria em aberto).
- `GET /api/netzos/melhorias?situacao=new,analysis`: pedidos de melhoria.
- `POST /api/netzos/melhorias/{id}/decisao` com `{ "decisao": "aprovar" | "recusar", "nota": "..." }`: mesma regra do
  botão em Plataforma > Melhorias (só pedidos novos ou em análise).

## Próximas ordens (etapa 2)

Registrar venda, dar entrada no estoque, aprovar cadastro de empresa. Cada uma entra como rota nova aqui, chamando a
mesma função de `@erp/core` que a tela usa.
