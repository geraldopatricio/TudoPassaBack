const fs = require('fs');
const path = require('path');
const integration = require('./integrationService');
const { mergeStock } = require('./alphaStock');
const history = require('./familyEfficiency');
const FILE = path.join(__dirname, '../database/produtos/produtos.json');
function createCatalog({ integration, readLocal, record }) {
  return async function productCatalog({ forceRefresh = false, includeOutOfStock = false } = {}) {
    const remote = await integration.list('produtos', { includeOutOfStock: true, forceRefresh });
    const local = readLocal();
    const saved = new Map(local.map(p => [String(p.referencia), p]));
    const products = remote ? remote.map(p => {
      const merged = mergeStock(p, saved.get(String(p.referencia)) || {});
      if (p.preco_alpha !== undefined) {
        merged.preco_alpha = p.preco_alpha;
        merged.variantes = (merged.variantes || []).map(v => ({ ...v, valor_unitario: p.preco_alpha, valor_total: p.preco_alpha * Number(v.quantidade_total || 0) }));
      }
      return merged;
    }) : local;
    record(products);
    return includeOutOfStock ? products : products.filter(p => !p.estoque_alpha || p.estoqueGeral > 0);
  };
}
module.exports = createCatalog({ integration, readLocal: () => fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [], record: history.record });
module.exports.createCatalog = createCatalog;
