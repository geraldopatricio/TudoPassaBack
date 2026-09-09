const axios = require('axios');
const integration = require('./integrationService');

const positiveCode = (value, field) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`Configure ${field} com o código da integradora.`);
  return number;
};
const amount = (value, field) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Valor inválido: ${field}.`);
  return number;
};

function alphaPayload(pedido, itens, spec) {
  const defaults = spec.defaults || {};
  const produtos = [];
  for (const item of itens) {
    const referencia = String(item.referencia || '');
    if (!referencia) throw new Error('Produto sem referência.');
    const preco = amount(item.valor_unitario, 'preço');
    const codigoCor = positiveCode(item.codigo_cor, `cor do produto ${referencia}`);
    const position = Number(spec.sizePositions?.[item.tamanho]);
    if (!Number.isInteger(position) || position < 1 || position > 10) throw new Error(`Configure a posição Alpha (1 a 10) do tamanho ${item.tamanho}.`);
    const quantidade = positiveCode(item.quantidade, 'quantidade');
    let produto = produtos.find(p => p.referencia === referencia && p.preco === preco);
    if (!produto) { produto = { referencia, preco, grades: [] }; produtos.push(produto); }
    let grade = produto.grades.find(g => g.codigoCor === codigoCor);
    if (!grade) { grade = { codigoCor, ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`pos${i + 1}`, 0])) }; produto.grades.push(grade); }
    grade[`pos${position}`] += quantidade;
  }
  if (!produtos.length) throw new Error('Pedido sem produtos.');
  return {
    codigoCliente: positiveCode(pedido.cliente_codigo, 'cliente'),
    codigoVendedor: positiveCode(defaults.codigoVendedor, 'vendedor'),
    codigoLoja: positiveCode(defaults.codigoLoja, 'loja'),
    codigoPedidoEcommerce: String(pedido.id),
    tabelaPreco: positiveCode(defaults.tabelaPreco, 'tabela de preço'),
    desconto: amount(pedido.desconto || 0, 'desconto'), frete: amount(pedido.frete, 'frete'),
    dinheiro: 0, produtos, cartoes: [],
    outrosPagamentos: [{
      codigoFormaPagamento: positiveCode(defaults.codigoFormaPagamento, 'forma de pagamento PIX'),
      codigoCondicaoPagamento: positiveCode(defaults.codigoCondicaoPagamento, 'condição de pagamento'),
      codigoContaCorrente: positiveCode(defaults.codigoContaCorrente, 'conta corrente'),
      valor: amount(pedido.total, 'total'), identificador: null
    }]
  };
}

async function send(pedido, itens, config = integration.active()) {
  if (!config) return { status: 'local' };
  const base = { provider: config.provider, atualizado_em: new Date().toISOString() };
  const spec = config.resources?.vendas;
  let payload;
  try {
    if (!spec?.post) throw new Error('Configure o endpoint POST de vendas da integração.');
    if (config.provider === 'alpha' && !pedido.cliente_codigo) {
      const document = String(pedido.cliente_cpf || '').replace(/\D/g, '');
      const clients = document ? await integration.list('clientes') : [];
      const matches = (clients || []).filter(c => String(c.cpf_cnpj || '').replace(/\D/g, '') === document);
      if (matches.length === 1) pedido = { ...pedido, cliente_codigo: matches[0].codigo };
    }
    payload = config.provider === 'alpha' ? alphaPayload(pedido, itens, spec) : { ...pedido, itens };
  } catch (error) { return { ...base, status: 'erro_configuracao', mensagem: error.isAxiosError ? 'Não foi possível consultar o cliente na integradora.' : error.message }; }
  try {
    await axios({ method: 'post', url: integration.resolveEndpoint(config, spec.post), data: payload,
      headers: { ...integration.headers(config), 'Content-Type': 'application/json' }, timeout: 20000 });
    return { ...base, status: 'enviado' };
  } catch (error) {
    const httpStatus = error.response?.status;
    // A timeout or server error may happen AFTER the remote sale was created. Never retry automatically.
    const rejected = httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408;
    return { ...base, status: rejected ? 'rejeitado' : 'verificar', httpStatus,
      mensagem: rejected ? `Integradora recusou a venda (HTTP ${httpStatus}). Revise os dados.` : 'Confirme na integradora se a venda foi registrada antes de qualquer reenvio.' };
  }
}
module.exports = { alphaPayload, send };
