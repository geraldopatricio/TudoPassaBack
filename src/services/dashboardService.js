const dayKey = value => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const cents = value => Math.round(num(value) * 100);
function summarize(orders, items, start, end) {
  const selected = orders.filter(order => { const day = dayKey(order.data); return day && day >= start && day <= end; });
  const paid = selected.filter(order => order.status === 'Pago');
  const paidIds = new Set(paid.map(order => String(order.id)));
  const revenue = paid.reduce((sum, order) => sum + cents(order.total), 0) / 100;
  const products = new Map(), customers = new Map(), payments = new Map();
  const series = new Map();
  for (let date = new Date(`${start}T12:00:00Z`); date.toISOString().slice(0, 10) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    series.set(date.toISOString().slice(0, 10), { date: date.toISOString().slice(0, 10), revenue: 0, orders: 0 });
  }
  for (const order of selected) series.get(dayKey(order.data)).orders++;
  for (const order of paid) {
    series.get(dayKey(order.data)).revenue += cents(order.total);
    const key = order.cliente_codigo || String(order.cliente_cpf || '').replace(/\D/g, '') || order.cliente_email || `pedido-${order.id}`;
    if (!customers.has(String(key))) customers.set(String(key), { key: String(key), name: order.cliente_nome || 'Cliente não informado', orders: 0, revenue: 0 });
    const customer = customers.get(String(key)); customer.orders++; customer.revenue += cents(order.total);
    const method = order.forma_pagamento || 'Não informado';
    payments.set(method, (payments.get(method) || 0) + cents(order.total));
  }
  for (const item of items.filter(item => paidIds.has(String(item.pedido_id)))) {
    const key = String(item.referencia || 'Sem referência');
    if (!products.has(key)) products.set(key, { key, name: item.descricao || key, quantity: 0, revenue: 0 });
    const product = products.get(key); product.quantity += num(item.quantidade);
    product.revenue += cents(item.valor_total ?? num(item.quantidade) * num(item.valor_unitario));
  }
  const ranking = [...products.values()].map(p => ({ ...p, revenue: p.revenue / 100 })).sort((a, b) => b.revenue - a.revenue || a.key.localeCompare(b.key));
  const totalProducts = ranking.reduce((sum, p) => sum + cents(p.revenue), 0);
  let accumulated = 0;
  const abc = ranking.map(p => {
    const before = totalProducts > 0 ? accumulated / totalProducts : 0;
    accumulated += cents(p.revenue);
    return { ...p, class: totalProducts <= 0 || p.revenue <= 0 ? 'C' : before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C', share: totalProducts > 0 ? cents(p.revenue) / totalProducts * 100 : 0, accumulated: totalProducts > 0 ? accumulated / totalProducts * 100 : 0 };
  });
  return {
    revenue, orders: selected.length, paid: paid.length, ticket: paid.length ? revenue / paid.length : 0,
    units: ranking.reduce((sum, p) => sum + p.quantity, 0), buyers: customers.size,
    statuses: ['Pago', 'Pendente', 'Cancelado', 'Outros'].map(name => ({ name, count: selected.filter(p => name === 'Outros' ? !['Pago', 'Pendente', 'Cancelado'].includes(p.status) : p.status === name).length })),
    series: [...series.values()].map(p => ({ ...p, revenue: p.revenue / 100 })),
    topProducts: [...ranking].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 5),
    topCustomers: [...customers.values()].map(({ key, ...p }) => ({ ...p, revenue: p.revenue / 100 })).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    payments: [...payments].map(([name, value]) => ({ name, value: value / 100 })).sort((a, b) => b.value - a.value), abc,
    excludedDates: orders.filter(p => !dayKey(p.data)).length
  };
}
module.exports = { summarize };
