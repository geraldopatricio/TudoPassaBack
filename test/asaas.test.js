const { test } = require('node:test');
const assert = require('node:assert/strict');
const { received, qrImage } = require('../src/services/asaasService');
const { orderEmail } = require('../src/services/orderEmail');
test('Pix only advances after receipt with matching amount and billing type', () => {
  for (const status of ['PENDING', 'CONFIRMED', 'REFUNDED', 'OVERDUE']) assert.equal(received({ billingType: 'PIX', status, value: 110 }, 110), false);
  assert.equal(received({ billingType: 'PIX', status: 'RECEIVED', value: 110 }, 110), true);
  assert.equal(received({ billingType: 'PIX', status: 'RECEIVED', value: 100 }, 110), false);
  assert.equal(received({ billingType: 'BOLETO', status: 'RECEIVED', value: 110 }, 110), false);
});
test('normalizes image prefix and rejects error images and missing QR', () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
  assert.equal(qrImage(`data:image/png;base64,${png}`), png);
  assert.throws(() => qrImage('undefined'));
  assert.throws(() => qrImage(''));
});
test('email includes complete Pix payload, total, pending status and escapes customer data', () => {
  const mail = orderEmail({ cliente: { nome: '<script>', email: 'test@example.com' }, itens: [], total: 110, frete: 10, pixData: { copyPaste: '000201-test-pix', invoiceUrl: 'https://www.asaas.com/i/test' }, pedidoId: '1' });
  assert.ok(mail.html.includes('000201-test-pix'));
  assert.ok(mail.html.includes('PENDENTE'));
  assert.ok(mail.html.includes('&lt;script&gt;'));
  assert.ok(mail.html.includes('border:1px dashed'));
  assert.ok(mail.text.includes('000201-test-pix'));
});
