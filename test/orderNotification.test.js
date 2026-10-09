const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('PDV mail goes to customer and MAIL_MARKETING with paid status', async () => {
  let message;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/orderNotification.js'), 'utf8'), {
    module, process: { env: { SMTP_SERVER: 'smtp.example.com', SMTP_USER: 'sender@example.com', SMTP_PASS: 'test', MAIL_MARKETING: 'marketing@example.com', ORDER_EMAIL_COPY: 'old@example.com' } },
    require: name => name === 'nodemailer' ? { createTransport: () => ({ sendMail: async mail => { message = mail; return { rejected: [] }; } }) } : { orderEmail: () => ({}) }
  });
  const result = await module.exports.sendOrderEmail({ cliente: { nome: 'Cliente', email: 'customer@example.com' }, itens: [], numeroPedido: 7, total: 100, subtotal: 100, status: 'Pago', formaPagamento: 'Dinheiro' });
  assert.deepEqual(Array.from(message.to), ['customer@example.com', 'marketing@example.com']);
  assert.ok(message.html.includes('PAGO'));
  assert.ok(!message.html.includes('PENDENTE'));
  assert.equal(result.status, 'enviado');
});
