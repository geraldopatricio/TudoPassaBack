// Missing flags keep existing colors available until explicitly disabled.
const colorKey = variant => String(variant.codigo_cor ?? variant.cor_codigo_nome ?? '').trim().toUpperCase();

function saleProducts(products) {
  return products.map(product => {
    const variantes = (product.variantes || []).filter(v => v.disponivel !== false).map(v => {
      const grade = Object.fromEntries(Object.entries(v.grade || {}).filter(([, stock]) => Number(stock) > 0));
      return { ...v, grade, quantidade_total: Object.values(grade).reduce((sum, stock) => sum + Number(stock), 0) };
    }).filter(v => Object.keys(v.grade).length > 0);
    return { ...product, variantes };
  }).filter(product => product.variantes.length > 0);
}

module.exports = { colorKey, saleProducts };
