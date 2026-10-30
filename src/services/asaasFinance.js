const { client } = require('./asaasService');
const day = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const shift = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const money = n => Math.round(Number(n || 0) * 100);
function ranges(now = new Date()) {
  const today = day(now), monthStart = `${today.slice(0, 7)}-01`;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return { today, weekEnd: shift(today, 6), monthStart, monthEnd: d.toISOString().slice(0, 10) };
}
async function all(api, path, params) {
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 100) {
    const { data } = await api.get(path, { params: { ...params, limit: 100, offset } });
    if (!Array.isArray(data.data)) throw new Error('Resposta de listagem Asaas invalida.');
    rows.push(...data.data);
    if (!data.hasMore) return rows;
    if (!data.data.length) throw new Error('Paginacao Asaas incompleta.');
  }
  throw new Error('Volume excede o limite de consulta integral. Reduza o periodo.');
}
async function overview(api = client(), now = new Date()) {
  const dates = ranges(now);
  const stat = params => api.get('/finance/payment/statistics', { params }).then(r => r.data);
  const pending = (from, to) => stat({ status: 'PENDING', 'dueDate[ge]': from, 'dueDate[le]': to });
  const jobs = {
    balance: () => api.get('/finance/balance').then(r => r.data),
    pending: () => stat({ status: 'PENDING' }),
    overdue: () => stat({ status: 'OVERDUE' }),
    confirmed: () => stat({ status: 'CONFIRMED' }),
    received: () => stat({ status: 'RECEIVED' }),
    today: () => pending(dates.today, dates.today),
    week: () => pending(dates.today, dates.weekEnd),
    month: () => pending(dates.today, dates.monthEnd),
    transactions: () => all(api, '/financialTransactions', { startDate: dates.monthStart, finishDate: dates.today })
  };
  const keys = Object.keys(jobs), results = await Promise.allSettled(keys.map(k => jobs[k]()));
  const result = { dates, updatedAt: new Date().toISOString(), warnings: [] };
  results.forEach((r, i) => {
    result[keys[i]] = r.status === 'fulfilled' ? r.value : null;
    if (r.status === 'rejected') result.warnings.push({ section: keys[i], message: r.reason.response?.data?.errors?.map(e => e.description).join('; ') || 'Consulta indisponivel no Asaas.' });
  });
  if (result.transactions) {
    const rows = result.transactions;
    const daily = new Map();
    for (let date = dates.monthStart; date <= dates.today; date = shift(date, 1)) daily.set(date, { date, inflow: 0, outflow: 0 });
    for (const row of rows) {
      const point = daily.get(String(row.date).slice(0, 10));
      if (point) { point.inflow += Math.max(0, money(row.value)); point.outflow += Math.max(0, -money(row.value)); }
    }
    result.dailyCashFlow = [...daily.values()].map(p => ({ ...p, inflow: p.inflow / 100, outflow: p.outflow / 100 }));
    result.cashFlow = {
      inflow: rows.reduce((sum, r) => sum + Math.max(0, money(r.value)), 0) / 100,
      outflow: rows.reduce((sum, r) => sum + Math.max(0, -money(r.value)), 0) / 100,
      net: rows.reduce((sum, r) => sum + money(r.value), 0) / 100,
      paymentsReceived: rows.filter(r => r.type === 'PAYMENT_RECEIVED').reduce((sum, r) => sum + money(r.value), 0) / 100
    };
  } else result.cashFlow = null;
  delete result.transactions;
  return result;
}
module.exports = { ranges, all, overview };
