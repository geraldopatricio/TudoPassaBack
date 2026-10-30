const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const asaas = require('../services/asaasService');
const finance = require('../services/asaasFinance');
const grid = require('../services/asaasGrid').createGrid();
const LEDGER = path.join(__dirname, '../database/asaas/operations.json');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function authorized(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const [payload, signature] = token.split('.');
    if (!payload || !signature) fail('Entre novamente para acessar o Asaas.', 401);
    const expected = crypto.createHmac('sha256', process.env.AUTH_SECRET || 'tudo-passa-local-auth-secret').update(payload).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) fail('Sessao invalida.', 401);
    const { login } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const users = JSON.parse(fs.readFileSync(path.join(__dirname, '../database/usuarios/usuarios.json'), 'utf8'));
    const user = users.find(u => u.login === login);
    if (!user || !['Admin', 'Gerente'].includes(user.tipo)) fail('Acesso restrito a Admin e Gerente.', 403);
    req.usuario = user;
    next();
  } catch (e) { res.status(e.status || 401).json({ message: e.message }); }
}
router.use(authorized);
const handle = fn => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) {
    const status = e.status || (e.response?.status === 429 ? 429 : e.response?.status >= 400 && e.response?.status < 500 ? 400 : 502);
    res.status(status).json({ message: e.response?.data?.errors?.map(x => x.description).join('; ') || e.message || 'Falha ao consultar Asaas.' });
  }
};
const id = value => { if (!/^[a-zA-Z0-9_-]{3,100}$/.test(value || '')) fail('Identificador invalido.'); return value; };
const date = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail('Informe uma data valida.');
  return value;
};
const pick = (body, keys) => Object.fromEntries(keys.filter(k => body[k] !== undefined).map(k => [k, body[k]]));
const page = req => ({ limit: 10, offset: (Math.max(1, Math.floor(Number(req.query.page) || 1)) - 1) * 10 });
async function list(req, resource, fields, enrich = false) {
  const api = asaas.client();
  const params = { ...pick(req.query, fields), ...page(req) };
  const { data } = await api.get(resource, { params });
  if (enrich) {
    if (resource === '/invoices') data.data = await Promise.all(data.data.map(async row => {
      if (row.customer || !row.payment) return row;
      try { const payment = (await api.get('/payments/' + id(row.payment))).data; return { ...row, customer: payment.customer }; }
      catch { return row; }
    }));
    const ids = [...new Set(data.data.map(row => row.customer).filter(Boolean))];
    const customers = new Map(await Promise.all(ids.map(async customer => {
      try { return [customer, (await api.get(`/customers/${id(customer)}`)).data]; }
      catch { return [customer, { id: customer, name: customer, unavailable: true }]; }
    })));
    data.data = data.data.map(row => ({ ...row, customerData: customers.get(row.customer) }));
  }
  return data;
}
// Persist a request before sending it. An uncertain result cannot be retried as a new charge.
async function mutate(req, method, endpoint, body) {
  const requestId = req.headers['x-request-id'];
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId || '')) fail('Identificador da operacao obrigatorio.');
  const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : {};
  const key = `${req.usuario.login}:${requestId}`;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([method, endpoint, body])).digest('hex');
  if (ledger[key] && ledger[key].status !== 'rejected') {
    if (ledger[key].fingerprint !== fingerprint) fail('Identificador ja utilizado em outra operacao.', 409);
    if (ledger[key].status === 'done') return ledger[key].result;
    fail('Operacao ja enviada. Atualize a lista e confira no Asaas antes de repetir.', 409);
  }
  const save = () => { fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); const latest = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : {}; latest[key] = ledger[key]; fs.writeFileSync(`${LEDGER}.tmp`, JSON.stringify(latest, null, 2)); fs.renameSync(`${LEDGER}.tmp`, LEDGER); };
  ledger[key] = { fingerprint, status: 'pending', at: new Date().toISOString(), user: req.usuario.login, method, endpoint };
  save();
  try {
    const { data } = await asaas.client().request({ method, url: endpoint, ...(body ? { data: body } : {}) });
    ledger[key].status = 'done'; ledger[key].result = data; save(); grid.invalidate();
    return data;
  } catch (e) {
    ledger[key].status = e.response?.status >= 400 && e.response?.status < 500 ? 'rejected' : 'uncertain';
    save();
    throw e;
  }
}
router.get('/grid', handle(req => grid.load(asaas.client(), req.query)));
router.get('/overview', handle(() => finance.overview()));
router.get('/customers', handle(req => list(req, '/customers', ['name', 'email', 'cpfCnpj'])));
router.get('/payments', handle(req => list(req, '/payments', ['customer', 'status', 'billingType', 'subscription', 'dueDate[ge]', 'dueDate[le]', 'paymentDate[ge]', 'paymentDate[le]'], true)));
router.get('/subscriptions', handle(req => list(req, '/subscriptions', ['customer', 'status', 'billingType'], true)));
router.get('/invoices', handle(req => list(req, '/invoices', ['customer', 'payment', 'status', 'effectiveDate[ge]', 'effectiveDate[le]'], true)));
router.get('/transactions', handle(req => list(req, '/financialTransactions', ['startDate', 'finishDate', 'order'])));
router.get('/services', handle(req => list(req, '/fiscalInfo/services', ['description'])));
router.get('/payments/:id', handle(async req => (await asaas.client().get(`/payments/${id(req.params.id)}`)).data));
router.get('/payments/:id/pix', handle(req => asaas.pix(id(req.params.id))));
const customerKeys = ['name', 'cpfCnpj', 'email', 'phone', 'mobilePhone', 'address', 'addressNumber', 'complement', 'province', 'postalCode', 'externalReference', 'observations'];
router.post('/customers', handle(req => {
  const body = pick(req.body, customerKeys);
  if (!body.name?.trim() || ![11, 14].includes(String(body.cpfCnpj || '').replace(/\D/g, '').length)) fail('Informe nome e CPF/CNPJ valido.');
  body.cpfCnpj = String(body.cpfCnpj).replace(/\D/g, '');
  return mutate(req, 'post', '/customers', body);
}));
router.put('/customers/:id', handle(req => mutate(req, 'put', `/customers/${id(req.params.id)}`, pick(req.body, customerKeys))));
function charge(body, recurring = false) {
  const result = pick(body, ['customer', 'billingType', 'value', 'description', 'externalReference', recurring ? 'nextDueDate' : 'dueDate', ...(recurring ? ['cycle', 'endDate', 'maxPayments'] : [])]);
  id(result.customer);
  if (!['PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED'].includes(result.billingType)) fail('Forma de pagamento invalida.');
  if (!Number.isFinite(Number(result.value)) || Number(result.value) <= 0) fail('Informe valor positivo.');
  result.value = Number(result.value);
  date(result[recurring ? 'nextDueDate' : 'dueDate']);
  if (recurring && !['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY'].includes(result.cycle)) fail('Recorrencia invalida.');
  if (result.endDate) date(result.endDate);
  return result;
}
router.post('/payments', handle(req => mutate(req, 'post', '/payments', charge(req.body))));
router.put('/payments/:id', handle(req => {
  const body = pick(req.body, ['value', 'dueDate', 'description']);
  if (body.value !== undefined && (!Number.isFinite(Number(body.value)) || Number(body.value) <= 0)) fail('Valor invalido.');
  if (body.dueDate) date(body.dueDate);
  return mutate(req, 'put', `/payments/${id(req.params.id)}`, body);
}));
router.delete('/payments/:id', handle(req => mutate(req, 'delete', `/payments/${id(req.params.id)}`)));
router.post('/subscriptions', handle(req => mutate(req, 'post', '/subscriptions', charge(req.body, true))));
router.put('/subscriptions/:id', handle(req => mutate(req, 'put', `/subscriptions/${id(req.params.id)}`, charge(req.body, true))));
router.delete('/subscriptions/:id', handle(req => mutate(req, 'delete', `/subscriptions/${id(req.params.id)}`)));
function invoicePayload(input) {
  const body = pick(input, ['payment', 'customer', 'serviceDescription', 'observations', 'value', 'deductions', 'effectiveDate', 'municipalServiceId', 'municipalServiceCode', 'municipalServiceName', 'taxes', 'externalReference']);
  if (!body.payment && !body.customer) fail('Selecione cliente ou cobranca.');
  if (body.payment) id(body.payment);
  if (body.customer) id(body.customer);
  if (!body.serviceDescription?.trim() || !body.municipalServiceName?.trim() || (!body.municipalServiceId && !body.municipalServiceCode)) fail('Informe descricao e servico fiscal municipal.');
  date(body.effectiveDate);
  if (!Number.isFinite(Number(body.value)) || Number(body.value) <= 0) fail('Valor da nota invalido.');
  if (!body.taxes || typeof body.taxes !== 'object' || Array.isArray(body.taxes)) fail('Informe os impostos da nota.');
  return body;
}
router.post('/invoices', handle(req => mutate(req, 'post', '/invoices', invoicePayload(req.body))));
router.put('/invoices/:id', handle(req => mutate(req, 'put', `/invoices/${id(req.params.id)}`, invoicePayload(req.body))));
router.post('/invoices/:id/authorize', handle(req => mutate(req, 'post', `/invoices/${id(req.params.id)}/authorize`, {})));
router.post('/invoices/:id/cancel', handle(req => mutate(req, 'post', `/invoices/${id(req.params.id)}/cancel`, {})));
module.exports = router;
module.exports.authorized = authorized;
