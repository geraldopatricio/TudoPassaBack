const { all } = require('./asaasFinance');
const crypto = require('crypto');
const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const dateLabel = value => value ? String(value).slice(0, 10).split('-').reverse().join('/') : '';
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const cash = n => currency.format(Number(n || 0));
function join(customers, payments, invoices, invoicesAvailable = true) {
  const customerMap = new Map(customers.map(c => [c.id, c]));
  const byCustomer = new Map(), byPayment = new Map(), customerInvoices = new Map();
  for (const p of payments.filter(p => !p.deleted)) {
    if (!byCustomer.has(p.customer)) byCustomer.set(p.customer, []);
    byCustomer.get(p.customer).push(p);
    if (!customerMap.has(p.customer)) customerMap.set(p.customer, { id: p.customer, name: p.customer, unavailable: true });
  }
  for (const invoice of invoices) {
    if (invoice.payment) {
      if (!byPayment.has(invoice.payment)) byPayment.set(invoice.payment, []);
      byPayment.get(invoice.payment).push(invoice);
    } else if (invoice.customer) {
      if (!customerInvoices.has(invoice.customer)) customerInvoices.set(invoice.customer, []);
      customerInvoices.get(invoice.customer).push(invoice);
    }
  }
  return [...customerMap.values()].flatMap(c => (byCustomer.get(c.id) || [null]).map(p => ({
    id: p?.id || 'customer_' + c.id, customerData: c, paymentData: p,
    customerCreated: c.dateCreated || '', chargeCreated: p?.dateCreated || '',
    invoices: p ? byPayment.get(p.id) || [] : customerInvoices.get(c.id) || [], invoicesAvailable,
    source: p?.checkoutSession ? 'Checkout Asaas' : p?.paymentLink ? 'Link Asaas' : 'Asaas',
    recurring: !!p?.subscription,
    account: c.unavailable ? 'Cadastro indisponivel' : c.deleted ? 'Cadastro excluido' : 'Cadastro ativo'
  })));
}
const paymentNames = { PENDING: 'Pendente', OVERDUE: 'Vencido', RECEIVED: 'Recebido', CONFIRMED: 'Confirmado', REFUNDED: 'Estornado', RECEIVED_IN_CASH: 'Recebido em dinheiro' };
const invoiceNames = { AUTHORIZED: 'Autorizada', SCHEDULED: 'Agendada', ERROR: 'Erro', CANCELED: 'Cancelada', PROCESSING_CANCELLATION: 'Cancelamento em processamento', CANCELLATION_DENIED: 'Cancelamento recusado' };
function values(row) {
  const p = row.paymentData, c = row.customerData;
  return {
    customer: [c.name, c.cpfCnpj, c.email, c.mobilePhone, c.id].filter(Boolean).join(' '),
    customerCreated: row.customerCreated,
    chargeCreated: row.chargeCreated,
    source: row.source,
    charge: p ? [cash(p.value), p.description, p.id, p.dueDate, dateLabel(p.dueDate)].join(' ') : 'Sem cobranca',
    payment: p ? [paymentNames[p.status], p.status, p.billingType].join(' ') : 'Sem cobranca',
    activity: p?.lastInvoiceViewedDate ? 'Fatura visualizada ' + dateLabel(p.lastInvoiceViewedDate) : 'Sem registro de visualizacao',
    account: row.account,
    invoice: !row.invoicesAvailable ? 'Consulta indisponivel' : row.invoices.length ? row.invoices.map(i => [i.number, i.id, i.status, invoiceNames[i.status]].join(' ')).join(' ') : 'Pendente de emissao',
    recurring: row.recurring ? 'Sim recorrente' : 'Nao avulsa'
  };
}
function queryRows(rows, query = {}) {
  const start = query.customerStart || '', end = query.customerEnd || '';
  const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  if ((start && !validDate(start)) || (end && !validDate(end)) || (start && end && start > end)) throw Object.assign(new Error('Periodo de cadastro invalido.'), { status: 400 });
  const q = normalize(query.search);
  const selected = rows.filter(row => {
    const p = row.paymentData, v = values(row);
    if ((start && row.customerCreated < start) || (end && (!row.customerCreated || row.customerCreated > end))) return false;
    if (query.dueStart && (!p?.dueDate || p.dueDate < query.dueStart)) return false;
    if (query.dueEnd && (!p?.dueDate || p.dueDate > query.dueEnd)) return false;
    if (query.purchased === 'yes' && !p) return false;
    if (query.purchased === 'no' && p) return false;
    if (query.customer && row.customerData.id !== query.customer) return false;
    if (query.subscription && p?.subscription !== query.subscription) return false;
    if (query.status && p?.status !== query.status) return false;
    if (query.billingType && p?.billingType !== query.billingType) return false;
    if (query.account && (row.customerData.deleted ? 'deleted' : row.customerData.unavailable ? 'unknown' : 'active') !== query.account) return false;
    if (query.invoiceStatus === 'none' && (!row.invoicesAvailable || row.invoices.length)) return false;
    if (query.invoiceStatus && query.invoiceStatus !== 'none' && (!row.invoicesAvailable || !row.invoices.some(i => i.status === query.invoiceStatus))) return false;
    const document = String(query.search || '').replace(/\D/g, '');
    const matchesDocument = document.length >= 4 && String(row.customerData.cpfCnpj || '').replace(/\D/g, '').includes(document);
    if (q && !matchesDocument && !normalize(Object.values(v).join(' ') + ' ' + (p?.externalReference || '')).includes(q)) return false;
    for (const [key, value] of Object.entries(v)) {
      const filter = normalize(query['column.' + key]);
      if (filter && !normalize(value + ' ' + (key.endsWith('Created') ? dateLabel(value) : '')).includes(filter)) return false;
    }
    return true;
  });
  const sortBy = Object.keys(values(rows[0] || { customerData: {}, invoices: [] })).includes(query.sortBy) ? query.sortBy : 'customerCreated';
  const direction = query.sortDirection === 'asc' ? 1 : -1;
  selected.sort((a, b) => {
    const left = sortBy === 'charge' ? Number(a.paymentData?.value || 0) : values(a)[sortBy];
    const right = sortBy === 'charge' ? Number(b.paymentData?.value || 0) : values(b)[sortBy];
    return direction * (typeof left === 'number' ? left - right : String(left).localeCompare(String(right), 'pt-BR', { numeric: true })) || a.id.localeCompare(b.id);
  });
  const page = Math.max(1, Math.floor(Number(query.page) || 1)), offset = (page - 1) * 10;
  return { data: selected.slice(offset, offset + 10), totalCount: selected.length, hasMore: offset + 10 < selected.length, limit: 10, offset };
}
function createGrid() {
  let cached, inflight, accountKey;
  return {
    invalidate() { cached = null; },
    async load(api, query = {}) {
      const key = crypto.createHash('sha256').update(String(api.defaults?.baseURL || '') + String(api.defaults?.headers?.access_token || '')).digest('hex');
      if (key !== accountKey) { cached = null; accountKey = key; }
      if (!cached || Date.now() - cached.at >= 60000 || query.refresh === 'true') {
        if (!inflight) inflight = (async () => {
          const results = await Promise.allSettled([all(api, '/customers', {}), all(api, '/payments', {}), all(api, '/invoices', {})]);
          if (results[0].status !== 'fulfilled') throw results[0].reason;
          if (results[1].status !== 'fulfilled') throw results[1].reason;
          const fiscal = results[2].status === 'fulfilled';
          cached = { at: Date.now(), rows: join(results[0].value, results[1].value, fiscal ? results[2].value : [], fiscal), warnings: fiscal ? [] : ['Notas fiscais indisponiveis; o status fiscal nao pode ser confirmado.'] };
        })().finally(() => { inflight = null; });
        await inflight;
      }
      return { ...queryRows(cached.rows, query), updatedAt: new Date(cached.at).toISOString(), warnings: cached.warnings };
    }
  };
}
module.exports = { createGrid, join, queryRows };
