const axios = require('axios');
function client() {
  const key = process.env.ASAAS_API_KEY || process.env.ASAAS_TOKEN;
  const url = process.env.ASAAS_URL;
  if (!key || !url) throw new Error('Configure ASAAS_API_KEY e ASAAS_URL no backend.');
  const parsed = new URL(url.trim());
  if (['api.asaas.com', 'api-sandbox.asaas.com'].includes(parsed.hostname) && ['/', ''].includes(parsed.pathname)) parsed.pathname = '/v3';
  const api = axios.create({ baseURL: parsed.toString().replace(/\/$/, ''), timeout: 20000, headers: { access_token: key, 'User-Agent': 'TudoPassa/1.0' } });
  api.interceptors?.response.use(response => response, error => {
    const status = error.response?.status;
    const endpoint = error.config?.url || '';
    const details = error.response?.data?.errors?.map(e => e.description).filter(Boolean).join('; ');
    if (status && status !== 404) {
      const stage = endpoint.includes('/pixQrCode') ? 'obter QR Code' : endpoint === '/customers' ? 'consultar/cadastrar cliente' : 'consultar/criar cobrança';
      console.error('Falha Asaas:', { httpStatus: status, endpoint, codes: error.response?.data?.errors?.map(e => e.code) });
      error.message = `Asaas (${stage}, HTTP ${status}): ${details || 'Resposta sem descrição. Consulte os logs do Asaas e a configuração da conta.'}`;
    }
    if (error.response?.status === 404) {
      const path = error.config?.url || '';
      console.error('Asaas HTTP 404:', { host: parsed.hostname, basePath: parsed.pathname, endpoint: path });
      error.message = /^\/payments\/pay_/.test(path)
        ? 'A cobrança não foi encontrada no Asaas desta conta/ambiente. Confira se foi criada em produção ou sandbox e se a chave pertence à mesma conta. Não gere outra sem conferir a cobrança anterior.'
        : 'Endpoint do Asaas não encontrado. Configure ASAAS_URL=https://api.asaas.com/v3 e reinicie o backend.';
    }
    return Promise.reject(error);
  });
  return api;
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
  let data;
  if (reference) {
    const existing = (await api.get('/payments', { params: { externalReference: reference, limit: 100 } })).data;
    data = existing.data?.find(p => !p.deleted && p.customer === customer.id && p.billingType === 'PIX' && Math.round(Number(p.value) * 100) === Math.round(Number(valor) * 100));
  }
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const dueDate = `${date.year}-${date.month}-${date.day}`;
  if (!data) data = (await api.post('/payments', { customer: customer.id, billingType: 'PIX', value: Number(valor), externalReference: reference, dueDate })).data;
  if (!data.id) throw new Error('Asaas não retornou o identificador da cobrança. Confira ASAAS_URL=https://api.asaas.com/v3.');
  return { paymentId: data.id, ...(await pix(data.id)) };
}
async function pix(id) {
  const response = await client().get(`/payments/${id}/pixQrCode`);
  const data = response.data;
  if (!data || typeof data !== 'object') throw new Error('O endpoint Pix retornou uma página ou resposta inválida. Configure ASAAS_URL=https://api.asaas.com/v3 no backend.');
  if (!data.payload) {
    console.error('Resposta Pix sem payload:', { paymentId: id, httpStatus: response.status, fields: Object.keys(data), success: data.success, errors: data.errors });
    const details = data.errors?.map(e => e.description).filter(Boolean).join('; ') || data.message || data.description;
    throw new Error(details || `Asaas não disponibilizou o QR Code da cobrança ${id}. Verifique a cobrança e a habilitação Pix da conta no Asaas. Consulte os logs do backend para o diagnóstico.`);
  }
  return { qrCode: qrImage(data.encodedImage), copyPaste: data.payload, expirationDate: data.expirationDate };
}
module.exports = { client, payment, received, qrImage, createPix, pix };
