const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
function orderEmail({ cliente, itens, total, frete, pixData, pedidoId }) {
  if (!cliente?.email || !Array.isArray(itens) || !pixData?.copyPaste) throw new Error('Dados do pedido ou Pix ausentes.');
  const rows = itens.map(i => `<tr><td style="padding:12px;border-bottom:1px solid #eee">${escape(i.descricao)}<br><small>Cor: ${escape(i.chosenColor || i.codigoCor)} | Tam: ${escape(i.chosenSize)} | Qtd: ${escape(i.chosenQty)}</small></td><td>${money(i.totalPrice)}</td></tr>`).join('');
  const url = /^https:\/\/[^\s]+$/.test(pixData.invoiceUrl || '') ? pixData.invoiceUrl : null;
  return {
    text: `Pedido ${pedidoId || ''}\nOlá ${cliente.nome}, recebemos seu pedido.\nTotal: ${money(total)}\nAguardando pagamento Pix.\nPix copia e cola:\n${pixData.copyPaste}${url ? `\nAbrir fatura: ${url}` : ''}`,
    html: `<div style="background:#f4f7f6;padding:20px;font-family:Arial,sans-serif;color:#123"><div style="max-width:600px;margin:auto;background:white;border:1px solid #e3e9e7;border-radius:18px;overflow:hidden"><div style="background:#168b68;padding:28px;color:white;text-align:center"><h1 style="font-size:24px;margin:0">Pedido recebido</h1><p>Tudo Passa Store</p></div><div style="padding:24px"><h3>Informações do pedido</h3><p>Pagador: ${escape(cliente.nome)}</p><p>Pedido: ${escape(pedidoId)}</p><table style="width:100%;border-collapse:collapse">${rows}</table><p>Frete: ${money(frete)}</p><p><b>Total: ${money(total)}</b></p><h3>Pagar com PIX</h3><p>Copie o código abaixo e pague no app do seu banco:</p><div style="border:1px dashed #168b68;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;word-break:break-all;overflow-wrap:anywhere">${escape(pixData.copyPaste)}</div>${url ? `<p><a href="${escape(url)}" style="display:inline-block;background:#168b68;color:white;text-decoration:none;padding:12px 20px;border-radius:8px">Abrir fatura</a></p>` : ''}<h3>Status</h3><span style="background:#fff2bf;color:#986000;padding:6px 12px;border-radius:20px">PENDENTE</span><p>Esta cobrança aguarda seu pagamento. O pedido será confirmado após o recebimento do Pix.</p></div></div></div>`
  };
}
module.exports = { orderEmail };
