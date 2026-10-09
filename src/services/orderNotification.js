const nodemailer = require('nodemailer');
const { orderEmail } = require('./orderEmail');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function paidEmail(data) {
  const rows = data.itens.map(i => `<tr><td style="padding:12px;border-bottom:1px solid #eee">${escape(i.descricao)}<br><small>Cor: ${escape(i.chosenColor || i.codigoCor)} | Tam: ${escape(i.chosenSize)} | Qtd: ${escape(i.chosenQty)}</small></td><td>${money(i.totalPrice)}</td></tr>`).join('');
  return {
    text: `Pedido #${data.numeroPedido}\nCliente: ${data.cliente.nome}\n${data.itens.map(i => `${i.descricao} | ${i.chosenColor || ''} / ${i.chosenSize} | Qtd: ${i.chosenQty} | ${money(i.totalPrice)}`).join('\n')}\nTotal: ${money(data.total)}\nPagamento: ${data.formaPagamento}\nStatus: Pago`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden"><div style="background:#168b68;color:white;padding:24px"><h2>Pedido confirmado #${escape(data.numeroPedido)}</h2><p>Tudo Passa Store</p></div><div style="padding:24px"><p>Olá ${escape(data.cliente.nome)}, recebemos seu pedido.</p><table style="width:100%;border-collapse:collapse">${rows}</table><p>Subtotal: ${money(data.subtotal)}</p><p>Desconto: ${money(data.desconto || 0)}</p><p>Taxas: ${money(data.taxas || 0)}</p><p><b>Total: ${money(data.total)}</b></p><p>Pagamento: ${escape(data.formaPagamento)}</p><p style="color:#168b68"><b>Status: PAGO</b></p></div></div>`
  };
}

async function sendOrderEmail(data) {
  const host = process.env.SMTP_SERVER || process.env.SMTP_HOST;
  if (!host || !process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error('Configure SMTP_SERVER, SMTP_USER e SMTP_PASS no .env do TudoPassaBack.');
  const recipients = [...new Set([data.cliente?.email, process.env.MAIL_MARKETING || process.env.ORDER_EMAIL_COPY].filter(Boolean).flatMap(value => value.split(/[,;]/)).map(value => value.trim()).filter(Boolean))];
  if (!recipients.length) throw new Error('Informe o e-mail do cliente ou MAIL_MARKETING.');
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({ host, port, secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, connectionTimeout: 15000, socketTimeout: 20000 });
  const result = await transport.sendMail({
    from: { name: 'Tudo Passa Store', address: process.env.SMTP_USER },
    to: recipients,
    subject: data.status === 'Pago' ? `Pedido confirmado #${data.numeroPedido}` : `Pedido recebido - aguardando Pix - ${data.cliente.nome}`,
    ...(data.status === 'Pago' ? paidEmail(data) : orderEmail(data))
  });
  if (result.rejected?.length) throw new Error('O servidor de e-mail recusou um ou mais destinatários.');
  return { status: 'enviado', data: new Date().toISOString() };
}

module.exports = { sendOrderEmail, paidEmail };
