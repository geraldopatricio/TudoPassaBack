const axios = require('axios');
function client() {
  const key = process.env.ASAAS_API_KEY || process.env.ASAAS_TOKEN;
  const url = process.env.ASAAS_URL;
  if (!key || !url) throw new Error('Configure ASAAS_API_KEY e ASAAS_URL no backend.');
  return axios.create({ baseURL: url.replace(/\/$/, ''), timeout: 20000, headers: { access_token: key, 'User-Agent': 'TudoPassa/1.0' } });
}
async function payment(id) {
  if (!/^pay_[a-zA-Z0-9_]+$/.test(String(id))) throw new Error('Identificador de cobrança inválido.');
  return (await client().get(`/payments/${id}`)).data;
}
function received(data, total) {
  return data.billingType === 'PIX' && data.status === 'RECEIVED' && Math.round(Number(data.value) * 100) === Math.round(Number(total) * 100);
}
function qrImage(value) {
  const raw = String(value || '').replace(/^data:image\/png;base64,/i, '').replace(/\s/g, '');
  if (!raw || !Buffer.from(raw, 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('O Asaas não retornou uma imagem PNG válida para o Pix.');
  return raw;
}
async function createPix({ nome, email, cpf, valor, reference }) {
  const document = String(cpf || '').replace(/\D/g, '');
  if (!nome || ![11, 14].includes(document.length) || !Number.isFinite(Number(valor)) || Number(valor) <= 0) throw new Error('Informe nome, CPF/CNPJ e valor válidos para gerar o Pix.');
  const api = client();
  const search = await api.get('/customers', { params: { cpfCnpj: document } });
  const customer = search.data.data?.[0] || (await api.post('/customers', { name: nome, email, cpfCnpj: document })).data;
  const data = (await api.post('/payments', { customer: customer.id, billingType: 'PIX', value: Number(valor), externalReference: reference, dueDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) })).data;
  return { paymentId: data.id, ...(await pix(data.id)) };
}
async function pix(id) {
  const data = (await client().get(`/payments/${id}/pixQrCode`)).data;
  if (!data.payload) throw new Error('Asaas não retornou o código copia e cola.');
  return { qrCode: qrImage(data.encodedImage), copyPaste: data.payload, expirationDate: data.expirationDate };
}
module.exports = { client, payment, received, qrImage, createPix, pix };
