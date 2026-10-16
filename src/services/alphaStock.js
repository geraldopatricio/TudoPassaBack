const colorSize = grade => JSON.stringify([String(grade.codigoCor ?? '').trim(), String(grade.tamanho ?? '').trim().toUpperCase()]);

// Join the bulk stock endpoint to the catalog without distributing parent totals.
function applyStock(products, stocks) {
  const byReference = new Map();
  const seen = new Set();
  for (const row of stocks) {
    const reference = String(row.referencia ?? '');
    if (!Array.isArray(row.grades)) throw new Error(`A Alpha não retornou as grades do estoque de ${reference}.`);
    if (!byReference.has(reference)) byReference.set(reference, new Map());
    const grades = byReference.get(reference);
    for (const grade of row.grades) {
      const quantity = Number(grade.estoque);
      if (grade.estoque === undefined || grade.estoque === null || grade.estoque === '' || !Number.isFinite(quantity)) {
        throw new Error(`A Alpha retornou saldo inválido para o SKU ${grade.sku || reference}.`);
      }
      const key = colorSize(grade);
      const identity = JSON.stringify([reference, row.loja, grade.sku || key]);
      if (seen.has(identity)) throw new Error(`A Alpha repetiu o estoque do SKU ${grade.sku || reference} na mesma loja.`);
      seen.add(identity);
      const previous = grades.get(key);
      grades.set(key, { ...grade, tamanho: String(grade.tamanho || '').trim().toUpperCase(), estoque: (previous?.estoque || 0) + Math.max(0, quantity) });
    }
  }
  return products.map(product => {
    const reference = String(product.referencia ?? product.codigo ?? '');
    const stocks = byReference.get(reference) || new Map();
    const grades = new Map((product.grades || []).map(grade => [colorSize(grade), { ...grade, estoque: 0 }]));
    for (const [key, stock] of stocks) grades.set(key, { ...grades.get(key), ...stock });
    const result = [...grades.values()];
    return { ...product, grades: result, estoqueGeral: result.reduce((total, grade) => total + grade.estoque, 0), estoque_alpha: true };
  });
}

function mergeStock(remote, saved) {
  const merged = { ...remote, ...saved, referencia: remote.referencia };
  if (remote.estoque_alpha) {
    merged.estoque_alpha = true;
    merged.estoqueGeral = remote.estoqueGeral;
    merged.grades = remote.grades;
    merged.variantes = remote.variantes;
  }
  return merged;
}

module.exports = { applyStock, mergeStock };
