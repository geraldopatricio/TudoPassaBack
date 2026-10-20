const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const FILE = path.join(__dirname, '../database/dashboard/family-history.json');
const WEEK = 7 * 86400000;
const quantity = product => {
  if (product.estoque_alpha) return Math.max(0, Number(product.estoqueGeral) || 0);
  return (product.variantes || []).reduce((sum, variant) => sum + Object.values(variant.grade || {}).reduce((n, v) => n + Math.max(0, Number(v) || 0), 0), 0);
};
function family(value) {
  if (value == null || value === '') return { key: '', name: 'Sem família' };
  if (typeof value === 'object') {
    const name = String(value.descricao || value.nome || value.codigo || '').trim();
    return { key: String(value.codigo ?? name).trim(), name: name || 'Sem família' };
  }
  const name = String(value).trim();
  return { key: name, name: name || 'Sem família' };
}
const empty = () => ({ startedAt: null, products: {}, entries: [] });
function read(file = FILE) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : empty();
}
function save(state, file = FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}
// Only a complete successful catalog is observed. Missing references are not treated as zero stock.
function observe(state, products, { now = new Date().toISOString(), publication = null, adjustment = false } = {}) {
  const baseline = !state.startedAt;
  state.startedAt ||= now;
  const entriesByReference = new Map();
  for (const entry of state.entries) {
    if (!entriesByReference.has(entry.reference)) entriesByReference.set(entry.reference, []);
    entriesByReference.get(entry.reference).push(entry);
  }
  for (const product of products) {
    const ref = String(product.referencia);
    const previous = Object.hasOwn(state.products, ref) ? state.products[ref] : null;
    const published = product.venda_externa === true;
    const stock = quantity(product);
    const group = family(product.familia);
    // Once the ERP fills a missing family, backfill the unclassified entries only.
    if (group.key) for (const entry of entriesByReference.get(ref) || []) {
      if (!entry.family.key) entry.family = group;
    }
    const firstPublication = published && (!previous || !previous.published);
    const increase = published && previous?.published ? Math.max(0, stock - previous.stock) : 0;
    // Republish does not count the same inventory twice or restart its weekly window.
    const hasEntries = entriesByReference.has(ref);
    const units = firstPublication && !hasEntries ? stock : increase;
    if (!adjustment && units > 0) state.entries.push({
      id: randomUUID(), reference: ref, family: group, at: now, units,
      baseline: baseline && publication !== ref,
      source: firstPublication ? 'publication' : 'observed-increase'
    });
    Object.defineProperty(state.products, ref, { value: { stock, published, family: group, source: product.estoque_alpha ? 'alpha' : 'local' }, enumerable: true, writable: true, configurable: true });
  }
  return state;
}
function record(products, options, file = FILE) {
  const state = read(file);
  observe(state, products, options);
  save(state, file);
  return state;
}
// Local sales/returns are not receipts. Keep the last local stock observation in step.
function adjustLocal(items, direction, file = FILE) {
  if (!fs.existsSync(file)) return;
  const state = read(file);
  for (const item of items) {
    const p = Object.hasOwn(state.products, String(item.referencia)) && state.products[String(item.referencia)];
    if (p?.source === 'local') p.stock = Math.max(0, p.stock + direction * (Number(item.quantidade) || 0));
  }
  save(state, file);
}
const day = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
function summarize(state, orders, items, start, end, now = Date.now()) {
  // The date filter selects cohorts by entry; their full seven-day follow-up continues afterwards.
  const cutoff = now;
  const lots = state.entries.filter(e => Date.parse(e.at) <= cutoff).map(e => ({ ...e, sold: 0, weeklySold: 0, remaining: e.units }));
  const byReference = new Map();
  for (const lot of lots.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (!byReference.has(lot.reference)) byReference.set(lot.reference, []);
    byReference.get(lot.reference).push(lot);
  }
  const paid = new Map(orders.filter(o => o.status === 'Pago' && o.pago_em && Date.parse(o.pago_em) <= cutoff).map(o => [String(o.id), o]));
  let unmatchedUnits = 0;
  for (const item of items.filter(i => paid.has(String(i.pedido_id))).sort((a, b) => Date.parse(paid.get(String(a.pedido_id)).pago_em) - Date.parse(paid.get(String(b.pedido_id)).pago_em))) {
    const date = Date.parse(paid.get(String(item.pedido_id)).pago_em);
    if (date < Date.parse(state.startedAt)) continue;
    let units = Math.max(0, Number(item.quantidade) || 0);
    for (const lot of byReference.get(String(item.referencia)) || []) {
      if (date < Date.parse(lot.at)) continue;
      const used = Math.min(lot.remaining, units);
      lot.remaining -= used; lot.sold += used; units -= used;
      if (!lot.baseline && date < Date.parse(lot.at) + WEEK) lot.weeklySold += used;
      if (!units) break;
    }
    unmatchedUnits += units;
  }
  const groups = new Map();
  for (const lot of lots) {
    const key = lot.family.key;
    if (!groups.has(key)) groups.set(key, { key, name: lot.family.name, entered: 0, sold: 0, baseline: 0, cohortEntered: 0, cohortSold: 0, active: 0, completed: 0 });
    const group = groups.get(key);
    group.entered += lot.units; group.sold += lot.sold;
    if (lot.baseline) group.baseline += lot.units;
    if (!lot.baseline && day(lot.at) >= start && day(lot.at) <= end) {
      group.cohortEntered += lot.units; group.cohortSold += lot.weeklySold;
      group[Date.parse(lot.at) + WEEK <= cutoff ? 'completed' : 'active']++;
    }
  }
  const ratio = (sold, entered) => entered > 0 ? sold / entered * 100 : null;
  const families = [...groups.values()].map(g => ({ ...g, efficiency: ratio(g.sold, g.entered), cohortEfficiency: ratio(g.cohortSold, g.cohortEntered), difference: g.cohortEntered ? ratio(g.cohortSold, g.cohortEntered) - ratio(g.sold, g.entered) : null })).sort((a, b) => b.entered - a.entered || a.name.localeCompare(b.name));
  return {
    startedAt: state.startedAt, asOf: new Date(cutoff).toISOString(), families, unmatchedUnits,
    legacyPaidOrders: orders.filter(o => o.status === 'Pago' && !o.pago_em).length,
    cohorts: lots.filter(l => !l.baseline && day(l.at) >= start && day(l.at) <= end).map(l => ({
      id: l.id, reference: l.reference, familyKey: l.family.key, family: l.family.name, at: l.at,
      endsAt: new Date(Date.parse(l.at) + WEEK).toISOString(), entered: l.units, sold: l.weeklySold,
      efficiency: ratio(l.weeklySold, l.units), completed: Date.parse(l.at) + WEEK <= cutoff, source: l.source
    })).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  };
}
module.exports = { family, quantity, empty, observe, record, read, summarize, adjustLocal };
