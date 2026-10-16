const referenceOrder = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

const createdTime = product => {
  for (const field of ['data_cadastro', 'dataCadastro', 'created_at', 'createdAt', 'dataInclusao']) {
    if (!product[field]) continue;
    const time = Date.parse(product[field]);
    if (Number.isFinite(time)) return time;
  }
  return null;
};

// References are a deterministic fallback when the source omits creation dates.
module.exports = function newestProducts(products) {
  return products.map(product => ({ product, time: createdTime(product) })).sort((a, b) => {
    if (a.time !== null && b.time !== null && a.time !== b.time) return b.time - a.time;
    if (a.time !== null && b.time === null) return -1;
    if (a.time === null && b.time !== null) return 1;
    return referenceOrder.compare(String(b.product.referencia || ''), String(a.product.referencia || ''));
  }).map(item => item.product);
};
