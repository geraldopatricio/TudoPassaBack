const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { summarize, salesEvolution } = require('../services/dashboardService');
const familyHistory = require('../services/familyEfficiency');
const productCatalog = require('../services/productCatalog');
router.get('/', async (req, res) => {
  const { start, end } = req.query;
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (!valid(start) || !valid(end) || days < 1 || days > 366) return res.status(400).json({ message: 'Escolha um período válido de até 366 dias.' });
  try {
    const read = name => { const file = path.join(__dirname, '../database/pedidos', name); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []; };
    const orders = read('pedidos.json'), items = read('pedidos_itens.json');
    const previousEnd = new Date(Date.parse(start) - 86400000).toISOString().slice(0, 10);
    const previousStart = new Date(Date.parse(start) - days * 86400000).toISOString().slice(0, 10);
    const previous = summarize(orders, items, previousStart, previousEnd);
    let familyEfficiency;
    let evolution;
    try {
      const products = await productCatalog({ includeOutOfStock: true });
      evolution = salesEvolution(orders, items, products, start, end);
      familyEfficiency = { ...familyHistory.summarize(familyHistory.read(), orders, items, start, end, Date.now(), typeof req.query.colecao === 'string' && req.query.colecao ? req.query.colecao : null), available: true };
    } catch (_) {
      evolution = { available: false, family: [], category: [] };
      familyEfficiency = { available: false, message: 'Não foi possível atualizar o estoque e a análise por família. Tente novamente.' };
    }
    res.json({ ...summarize(orders, items, start, end), familyEfficiency, salesEvolution: evolution, start, end, previous: { start: previousStart, end: previousEnd, revenue: previous.revenue, paid: previous.paid }, updatedAt: new Date().toISOString() });
  } catch (_) { res.status(500).json({ message: 'Não foi possível calcular os indicadores de pedidos.' }); }
});
module.exports = router;
