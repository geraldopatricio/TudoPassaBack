const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const asaas = require('../services/asaasService');

const FIN_PATH = path.join(__dirname, '../database/financeiro/financeiro.json');

const readFIN = () => {
    try {
        if (!fs.existsSync(FIN_PATH)) return [];
        return JSON.parse(fs.readFileSync(FIN_PATH, 'utf-8') || '[]');
    } catch (e) { return []; }
};

const writeFIN = (data) => {
    if (!fs.existsSync(path.dirname(FIN_PATH))) fs.mkdirSync(path.dirname(FIN_PATH), { recursive: true });
    fs.writeFileSync(FIN_PATH, JSON.stringify(data, null, 2));
};

// Listar todos os lançamentos
router.post('/:id/estorno', (req, res) => require('./pedidos').estornarFinanceiro(req, res));
const pixLocks = new Set();
router.post('/:id/pix', async (req, res) => {
    const id = req.params.id;
    if (pixLocks.has(id)) return res.status(409).json({ message: 'Geração em andamento. Aguarde.' });
    pixLocks.add(id);
    try {
        const entry = readFIN().find(f => f.id === id);
        if (!entry) return res.status(404).json({ message: 'Lançamento não encontrado.' });
        if (entry.id_pedido) { req.params.id = entry.id_pedido; return await require('./pedidos').gerarPixPedido(req, res); }
        if (entry.situacao === 'Cancelado') return res.status(409).json({ message: 'Lançamento cancelado.' });
        let data;
        if (entry.asaas_payment_id) {
            const payment = await asaas.payment(entry.asaas_payment_id);
            if (['RECEIVED', 'CONFIRMED'].includes(payment.status)) {
                if (req.body.regenerate) return res.status(409).json({ message: 'O Asaas já recebeu esta cobrança. Não é possível substituí-la.' });
                return res.json({ success: true, paymentId: entry.asaas_payment_id, ...(await asaas.pix(entry.asaas_payment_id)), total: entry.valor_liquido, paid: true });
            }
            if (req.body.regenerate) {
                if (entry.situacao === 'Recebido' && req.body.allowPaid !== true) return res.status(409).json({ requiresConfirmation: true, message: 'Este lançamento está marcado como recebido. Deseja substituir o Pix pendente por uma nova cobrança?' });
                await asaas.client().delete(`/payments/${entry.asaas_payment_id}`);
            }
            else data = { paymentId: entry.asaas_payment_id, ...(await asaas.pix(entry.asaas_payment_id)) };
        }
        if (!data) {
            if (entry.situacao === 'Recebido' && req.body.allowPaid !== true) return res.status(409).json({ requiresConfirmation: true, message: 'Este lançamento está marcado como recebido. Gerar Pix criará uma nova cobrança do valor total. Deseja continuar?' });
            const file = path.join(__dirname, '../database/clientes/clientes.json');
            const clients = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
            const doc = String(entry.cliente_cpf || '').replace(/\D/g, '');
            const customer = clients.find(c => doc && String(c.cpf_cnpj || '').replace(/\D/g, '') === doc);
            data = await asaas.createPix({ nome: entry.cliente_nome, cpf: doc, email: customer?.email, valor: entry.valor_liquido, reference: entry.id });
        }
        const entries = readFIN();
        const saved = entries.find(f => f.id === id);
        Object.assign(saved, { asaas_payment_id: data.paymentId, pix_qr_code: data.qrCode, pix_copia_cola: data.copyPaste });
        writeFIN(entries);
        res.json({ success: true, ...data, total: entry.valor_liquido });
    } catch (error) { res.status(502).json({ message: error.response?.data?.errors?.map(e => e.description).join('; ') || error.message }); }
    finally { pixLocks.delete(id); }
});
router.put('/:id/pix/status', async (req, res) => {
    try {
        const entry = readFIN().find(f => f.id === req.params.id);
        if (!entry?.asaas_payment_id) return res.status(404).json({ message: 'Cobrança não encontrada.' });
        const payment = await asaas.payment(entry.asaas_payment_id);
        if (!asaas.received(payment, entry.valor_liquido)) return res.status(409).json({ message: 'Aguardando recebimento no Asaas.' });
        const entries = readFIN();
        const saved = entries.find(f => f.id === entry.id);
        if (!saved || saved.situacao === 'Cancelado') return res.status(409).json({ message: 'Lançamento cancelado ou removido.' });
        Object.assign(saved, { situacao: 'Recebido', data_pagamento: new Date().toISOString(), forma_pagamento: 'PIX' });
        writeFIN(entries);
        res.json({ status: 'Pago' });
    } catch { res.status(502).json({ message: 'Não foi possível consultar o Asaas.' }); }
});
router.get('/', (req, res) => {
    res.json(readFIN());
});

// Criar lançamento manual (Opcional)
router.post('/', (req, res) => {
    const lancamentos = readFIN();
    const novo = { id: `FIN${Date.now()}`, ...req.body };
    lancamentos.push(novo);
    writeFIN(lancamentos);
    res.status(201).json(novo);
});

// Atualizar situação (Ex: de 'Em aberto' para 'Recebido')
router.put('/:id', (req, res) => {
    let lancamentos = readFIN();
    const index = lancamentos.findIndex(f => f.id === req.params.id);
    if (index === -1) return res.status(404).json({ message: "Lançamento não encontrado" });

    lancamentos[index] = { ...lancamentos[index], ...req.body };
    writeFIN(lancamentos);
    res.json(lancamentos[index]);
});

// Excluir lançamento
router.delete('/:id', (req, res) => {
    let lancamentos = readFIN();
    lancamentos = lancamentos.filter(f => f.id !== req.params.id);
    writeFIN(lancamentos);
    res.json({ message: "Lançamento removido" });
});

module.exports = router;
