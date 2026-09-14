const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const router = express.Router();

const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, `../database/${name}/${name}.json`), 'utf8'));
const normalize = value => String(value ?? '').replace(/\D/g, '');
const linked = (values, login) => Array.isArray(values) && values.includes(login);

function authenticated(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return res.status(401).json({ message: 'Acesso não autorizado.' });
  const expected = crypto.createHmac('sha256', process.env.AUTH_SECRET || 'tudo-passa-local-auth-secret').update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(401).json({ message: 'Acesso não autorizado.' });
  try {
    const { login } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    req.usuario = read('usuarios').find(user => user.login === login);
    if (!req.usuario) return res.status(401).json({ message: 'Usuário não encontrado.' });
    next();
  } catch { return res.status(401).json({ message: 'Token inválido.' }); }
}

function allowedClients(req) {
  const { login, tipo } = req.usuario;
  const clientes = read('clientes');
  let allowed = clientes;
  if (tipo === 'Cliente') allowed = clientes.filter(c => linked(c.ref_usuarios, login));
  else if (['Vendedor', 'Revendedor', 'Afiliado'].includes(tipo)) {
    const codes = new Set(read('profissionais')
      .filter(p => p.tipo === tipo && linked(p.ref_usuarios, login))
      .flatMap(p => Array.isArray(p.ref_clientes) ? p.ref_clientes.map(String) : []));
    allowed = clientes.filter(c => codes.has(String(c.codigo)));
  } else if (!['Admin', 'Gerente'].includes(tipo)) allowed = [];

  return allowed;
}

function report(req) {
  const allowed = allowedClients(req);
  const byCode = new Map(allowed.map(c => [String(c.codigo), c]));
  const byCpf = new Map(allowed.filter(c => normalize(c.cpf_cnpj)).map(c => [normalize(c.cpf_cnpj), c]));
  const { pedido, cliente, inicio, fim } = req.query;
  const result = read('pedidos').flatMap(p => {
    const matched = byCode.get(String(p.cliente_codigo)) || byCpf.get(normalize(p.cliente_cpf));
    if (!matched) return [];
    if (pedido && !String(p.numero_pedido ?? p.id).includes(String(pedido))) return [];
    if (cliente && !String(matched.codigo).includes(String(cliente))) return [];
    const day = String(p.data || '').slice(0, 10);
    if ((inicio && day < inicio) || (fim && day > fim)) return [];
    return [{ numero_pedido: p.numero_pedido, data: p.data, cliente_codigo: matched.codigo,
      cliente_nome: p.cliente_nome || matched.nome, cliente_cpf: p.cliente_cpf,
      status: p.status, subtotal: p.subtotal, frete: p.frete, total: p.total }];
  }).sort((a, b) => String(b.data).localeCompare(String(a.data)));
  return result;
}

function stockReport(req) {
  const { codigo, descricao } = req.query;
  return read('produtos').filter(p =>
    (!codigo || String(p.referencia ?? p.codigo ?? '').toLowerCase().includes(String(codigo).toLowerCase())) &&
    (!descricao || String(p.descricao ?? '').toLocaleLowerCase('pt-BR').includes(String(descricao).toLocaleLowerCase('pt-BR')))
  ).map(p => {
    const variants = Array.isArray(p.variantes) ? p.variantes : [];
    return { codigo: p.referencia ?? p.codigo, descricao: p.descricao, categoria: p.categoria,
      preco: Number(variants[0]?.valor_unitario || 0),
      quantidade: variants.reduce((sum, v) => sum + (v.grade && typeof v.grade === 'object'
        ? Object.values(v.grade).reduce((n, qty) => n + (Number(qty) || 0), 0)
        : Number(v.quantidade_total || 0)), 0) };
  }).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt-BR', { numeric: true }));
}

const dayKey = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};

function financialReport(req) {
  const allowed = allowedClients(req);
  const cpfs = new Set(allowed.map(c => normalize(c.cpf_cnpj)).filter(Boolean));
  const codes = new Set(allowed.map(c => String(c.codigo)));
  const admin = ['Admin', 'Gerente'].includes(req.usuario.tipo);
  const orders = read('pedidos');
  const permittedOrderIds = new Set(orders.filter(p => codes.has(String(p.cliente_codigo)) || cpfs.has(normalize(p.cliente_cpf))).map(p => String(p.id)));
  const { inicio, fim } = req.query;
  const rows = read('financeiro').filter(f => {
    if (!admin && !cpfs.has(normalize(f.cliente_cpf)) && !permittedOrderIds.has(String(f.id_pedido))) return false;
    const day = dayKey(f.situacao === 'Recebido' ? f.data_pagamento || f.data_emissao : f.data_emissao);
    return day && (!inicio || day >= inicio) && (!fim || day <= fim);
  }).map(f => ({ id: f.id, numero_pedido: f.numero_pedido,
    data: dayKey(f.situacao === 'Recebido' ? f.data_pagamento || f.data_emissao : f.data_emissao),
    cliente_nome: f.cliente_nome, tipo_movimento: f.tipo_movimento, situacao: f.situacao || 'Em aberto',
    forma_pagamento: f.forma_pagamento, conta_financeira: f.conta_financeira,
    valor_original: Number(f.valor_original ?? f.valor_liquido ?? 0), valor_liquido: Number(f.valor_liquido ?? 0) }))
    .sort((a, b) => b.data.localeCompare(a.data) || String(b.id).localeCompare(String(a.id)));
  const sum = items => Math.round(items.reduce((n, f) => n + Math.round(f.valor_liquido * 100), 0)) / 100;
  return { rows, summary: { recebido: sum(rows.filter(f => f.situacao === 'Recebido')),
    aReceber: sum(rows.filter(f => !['Recebido', 'Cancelado'].includes(f.situacao))),
    cancelado: sum(rows.filter(f => f.situacao === 'Cancelado')) } };
}

const reports = { estoque: stockReport, financeiro: financialReport };
const columns = {
  estoque: ['codigo', 'descricao', 'categoria', 'preco', 'quantidade'],
  financeiro: ['id', 'numero_pedido', 'data', 'cliente_nome', 'tipo_movimento', 'situacao', 'forma_pagamento', 'conta_financeira', 'valor_original', 'valor_liquido']
};

router.get(['/estoque', '/financeiro'], authenticated, (req, res) => {
  try {
    const result = reports[req.path.slice(1)](req);
    const rows = Array.isArray(result) ? result : result.rows;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 10));
    res.json({ rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, summary: result.summary });
  } catch { res.status(500).json({ message: 'Erro ao gerar relatório.' }); }
});

router.get(['/estoque/exportar', '/financeiro/exportar'], authenticated, (req, res) => {
  try {
    const result = reports[req.path.split('/')[1]](req);
    res.json(Array.isArray(result) ? { rows: result } : result);
  } catch { res.status(500).json({ message: 'Erro ao exportar relatório.' }); }
});

router.post(['/estoque/email', '/financeiro/email'], authenticated, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'E-mail inválido.' });
  if (!process.env.SMTP_SERVER || !process.env.SMTP_USER || !process.env.SMTP_PASS) return res.status(503).json({ message: 'SMTP não configurado no .env.' });
  try {
    const kind = req.path.split('/')[1];
    const result = reports[kind](req);
    const rows = Array.isArray(result) ? result : result.rows;
    const keys = columns[kind];
    const csv = '\uFEFF' + [keys.join(';'), ...rows.map(row => keys.map(key => `"${String(row[key] ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`).join(';'))].join('\r\n');
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_SERVER, port: Number(process.env.SMTP_PORT || 465), secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email,
      subject: `Relatório de ${kind} - Tudo Passa`, text: `Segue o relatório com ${rows.length} registro(s).`,
      attachments: [{ filename: `relatorio-${kind}.csv`, content: Buffer.from(csv, 'utf8'), contentType: 'text/csv; charset=utf-8' }] });
    res.json({ message: 'Relatório enviado com sucesso.' });
  } catch { res.status(500).json({ message: 'Não foi possível enviar o relatório.' }); }
});

router.get('/pedidos', authenticated, (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.pageSize, 10) || 10));
    const rows = report(req);
    res.json({ rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize });
  } catch (error) { res.status(500).json({ message: 'Erro ao gerar relatório.' }); }
});

router.get('/pedidos/exportar', authenticated, (req, res) => {
  try { res.json({ rows: report(req) }); }
  catch { res.status(500).json({ message: 'Erro ao exportar relatório.' }); }
});

router.post('/pedidos/email', authenticated, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'E-mail inválido.' });
  if (!process.env.SMTP_SERVER || !process.env.SMTP_USER || !process.env.SMTP_PASS) return res.status(503).json({ message: 'SMTP não configurado no .env.' });
  try {
    const rows = report(req);
    const columns = ['numero_pedido', 'data', 'cliente_codigo', 'cliente_nome', 'cliente_cpf', 'status', 'subtotal', 'frete', 'total'];
    const csv = '\uFEFF' + [columns.join(';'), ...rows.map(row => columns.map(key => `"${String(row[key] ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`).join(';'))].join('\r\n');
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_SERVER, port: Number(process.env.SMTP_PORT || 465), secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email,
      subject: 'Relatório de pedidos - Tudo Passa', text: `Segue o relatório de pedidos com ${rows.length} registro(s).`,
      attachments: [{ filename: 'relatorio-pedidos.csv', content: Buffer.from(csv, 'utf8'), contentType: 'text/csv; charset=utf-8' }] });
    res.json({ message: 'Relatório enviado com sucesso.' });
  } catch { res.status(500).json({ message: 'Não foi possível enviar o relatório.' }); }
});

module.exports = router;
