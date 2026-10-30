# Eficiência por família no dashboard

`GET /dashboard?start=YYYY-MM-DD&end=YYYY-MM-DD` mantém os indicadores anteriores e acrescenta `familyEfficiency`. A página `/dashboard` substitui a Curva ABC por tabelas de famílias e coortes. `/dashboad` é um alias. A versão anterior está preservada em `TudoPassa/src/views/DashboardView.backup-2026-10-20.vue`; o campo `abc` da API foi mantido para permitir sua reutilização.

## Regras de cálculo

- Família: campo `familia` da API Alpha, aceitando código/descrição, código/nome ou texto. Não se confunde com categoria ou grupo. O valor remoto prevalece sobre cópias locais antigas. Referências sem família atual e entradas sem família são excluídas das taxas globais e das coortes, sem preenchimento retroativo.
- Escopo: produtos publicados no e-commerce (`venda_externa: true`) e pedidos atualmente **Pago**, do e-commerce ou PDV, com `pago_em` registrado. Vendas registradas somente no ERP não entram nestas taxas. Pedidos legados sem confirmação de pagamento datada são apresentados como excluídos.
- Global: unidades vendidas desde o início do acompanhamento divididas pelo saldo inicial e pelas novas entradas observadas. O saldo existente na primeira consulta é uma base inicial identificada separadamente, sem data histórica inventada.
- Coorte: cada nova publicação com saldo positivo ou reposição observada abre uma entrada, acompanhada no intervalo `[entrada, entrada + 168 horas)`. Uma venda exatamente no término não entra no semanal, mas continua no global. Republicar a referência não duplica a entrada ou reinicia o ciclo.
- As vendas são distribuídas pelas entradas mais antigas da referência (FIFO), sem contabilizar uma unidade em várias coortes. Vendas excedentes às entradas acompanhadas são sinalizadas e não entram nas taxas. Cancelados deixam de compor as taxas; retornos de estoque local por cancelamento não são novas entradas.
- Coortes da mesma família são agregadas por unidades, não pela média simples das porcentagens. A diferença frente ao global é expressa em pontos percentuais. Resultados de ciclos abertos são parciais.
- Datas do filtro selecionam o **início** das coortes, no horário de Brasília. O acompanhamento das vendas continua até os sete dias, mesmo depois da data final selecionada. O global continua acumulado até o momento da consulta.

## Coleta e limites dos dados

O cadastro/edição de produtos registra a publicação. Consultas completas bem-sucedidas ao catálogo observam os saldos; o servidor também faz uma consulta a cada minuto, independentemente de o dashboard estar aberto. O catálogo completo, inclusive referências com saldo zero, é observado antes do filtro de produtos disponíveis. Falhas de consulta não geram entradas fictícias. Saldos negativos ou nulos não criam entradas.

**A análise de entradas é observacional.** A integração existente consulta `/v1/produtos` e `/v1/produtos/estoques`; ela não importa um livro de movimentações de estoque. Uma entrada compensada por uma saída entre duas consultas pode ficar invisível, e um ajuste positivo no ERP pode ser interpretado como reposição. A data de uma reposição detectada é a da consulta. Portanto, estas taxas não representam o histórico integral ou uma apuração contábil de todas as entradas do ERP. Para apuração exata será necessário integrar eventos reais de entrada, com identificador, data e quantidade, e distinguir reposições, ajustes, devoluções e transferências. A interface explicita esse limite.

Os eventos e últimos saldos ficam em `src/database/dashboard/family-history.json`, gravado por substituição de arquivo temporário. Esse diretório está excluído do Git e deve ser persistido junto com os demais arquivos de banco em produção. A implementação segue o banco JSON existente e pressupõe uma única instância gravadora e a mesma configuração de ERP/loja durante o acompanhamento. Não apagar esse arquivo ao atualizar o código.

## Verificação

Os testes em `test/familyEfficiency.test.js` cobrem saldo inicial, publicação, idempotência, limite exato de sete dias, filtro de início com acompanhamento posterior, pagamentos, FIFO, taxas ponderadas, falta de família, estoque zerado e indisponibilidade do ERP. Testes existentes cobrem paginação, preços, mídia e confirmação de pagamentos.

## Recorte por coleção

O parâmetro opcional `colecao` em `GET /dashboard` filtra a eficiência global por família e as coortes pelo código da coleção (ou nome quando sem código). Sem filtro, inclui todas as coleções informadas. Produtos sem coleção ficam fora. Família e coleção são preservadas na entrada; para eventos legados sem o campo de coleção, usa-se a classificação atual. FIFO ocorre antes do filtro para evitar transferir vendas de lotes excluídos. Os demais indicadores comerciais de pedidos continuam independentes deste recorte.

## Habilitação por produto e nome de exibição

`usar_colecao_dashboard` é um booleano, desmarcado por padrão. Somente produtos explicitamente habilitados, com família e coleção, participam da eficiência global e das coortes. Alterar a marcação recalcula a inclusão do histórico existente sem criar entradas ou reiniciar ciclos.

`colecao.descricao_secundaria` guarda um nome de exibição opcional na coleção do produto, mantendo o código e a descrição original. O dashboard retorna `collectionFamilies`, agrupado por família e código da coleção, com unidades vendidas globais, vendas em sete dias e taxas ponderadas. Esses nomes não alteram a identidade da coleção. Vendas se referem aos pedidos pagos registrados no sistema.

O checkbox do produto se chama "Referencia para coleção" e pode ser marcado sem preencher coleção. O cadastro/edição não oferece seletor de coleção; a classificação existente da integração é preservada. A segunda descrição continua opcional quando há coleção. As métricas por coleção continuam exigindo uma classificação disponível para agrupar o produto.

## Evolução das vendas

`salesEvolution` retorna séries diárias por `family` e `category`, com valor dos itens e unidades de pedidos pagos, usando data de criação do pedido em Brasília. O gráfico permite alternar a dimensão e selecionar um grupo; períodos acima de 31 dias são agrupados por mês na interface. Usa o catálogo atual completo, incluindo produtos sem saldo. Referências sem família e itens sem produto no catálogo são excluídos. Categoria ausente não gera grupo. Valores dos itens não incluem frete nem rateio de descontos do pedido. Esta evolução comercial independe da habilitação de coortes por coleção.
