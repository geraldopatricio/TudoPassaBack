const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const asaas = require('../services/asaasService');
const { sendOrderEmail } = require('../services/orderNotification');
const salesIntegration = require('../services/salesIntegrationService');
const { randomUUID } = require('crypto');

const PEDIDOS_PATH = path.join(__dirname, '../database/pedidos/pedidos.json');
const ITENS_PATH = path.join(__dirname, '../database/pedidos/pedidos_itens.json');
const PRODUTOS_PATH = path.join(__dirname, '../database/produtos/produtos.json');
const FIN_PATH = path.join(__dirname, '../database/financeiro/financeiro.json');
const ENTREGAS_PATH = path.join(__dirname, '../database/logistica/entregas.json');

const readJSON = (filePath) => {
    try {
        if (!fs.existsSync(filePath)) return [];
        return JSON.parse(fs.readFileSync(filePath, 'utf-8') || '[]');
    } catch (e) { return []; }
};

const writeJSON = (filePath, data) => {
    if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

// --- FUNÇÕES AUXILIARES ---

const readFinanceiro = () => fs.existsSync(FIN_PATH)
    ? JSON.parse(fs.readFileSync(FIN_PATH, 'utf-8') || '[]') : [];

const cancelarLancamentoFinanceiro = (pedidoId) => {
    const financeiro = readFinanceiro();
    writeJSON(FIN_PATH, financeiro.filter(f => String(f.id_pedido) !== String(pedidoId)));
};

const processarBaixaEstoque = (itensPedido) => {
    try {
        let produtos = readJSON(PRODUTOS_PATH);
        itensPedido.forEach(item => {
            const pIndex = produtos.findIndex(p => p.referencia === item.referencia);
            if (pIndex !== -1) {
                const variante = produtos[pIndex].variantes.find(v => item.codigo_cor != null ? String(v.codigo_cor) === String(item.codigo_cor) : item.cor ? v.cor_codigo_nome === item.cor : produtos[pIndex].variantes.length === 1);
                const tamanho = item.tamanho;
                if (variante && variante.grade[tamanho] !== undefined) {
                    variante.grade[tamanho] -= Number(item.quantidade);
                    if (variante && variante.grade[tamanho] < 0) variante.grade[tamanho] = 0;
                    variante.quantidade_total = Object.values(variante.grade).reduce((acc, curr) => acc + Number(curr), 0);
                    variante.valor_total = variante.quantidade_total * variante.valor_unitario;
                }
            }
        });
        writeJSON(PRODUTOS_PATH, produtos);
        return true;
    } catch (e) {
        console.error("Erro ao dar baixa no estoque:", e);
        return false;
    }
};

const processarEstornoEstoque = (itensPedido) => {
    try {
        let produtos = readJSON(PRODUTOS_PATH);
        itensPedido.forEach(item => {
            const pIndex = produtos.findIndex(p => p.referencia === item.referencia);
            if (pIndex !== -1) {
                const variante = produtos[pIndex].variantes.find(v => item.codigo_cor != null ? String(v.codigo_cor) === String(item.codigo_cor) : item.cor ? v.cor_codigo_nome === item.cor : produtos[pIndex].variantes.length === 1);
                const tamanho = item.tamanho;
                if (variante && variante.grade[tamanho] !== undefined) {
                    variante.grade[tamanho] += Number(item.quantidade);
                    variante.quantidade_total = Object.values(variante.grade).reduce((acc, curr) => acc + Number(curr), 0);
                    variante.valor_total = variante.quantidade_total * variante.valor_unitario;
                }
            }
        });
        writeJSON(PRODUTOS_PATH, produtos);
    } catch (e) {
        console.error("Erro ao estornar estoque:", e);
    }
};

const gerarLancamentoFinanceiro = (pedido) => {
        const financeiro = readFinanceiro();
        const existing = financeiro.find(f => String(f.id_pedido) === String(pedido.id));
        if (existing) {
            if (pedido.status === 'Pago') { existing.situacao = 'Recebido'; existing.data_pagamento = new Date().toISOString(); writeJSON(FIN_PATH, financeiro); }
            return;
        }
        const novoLancamento = {
            id: `FIN${randomUUID()}`,
            id_pedido: pedido.id,
            numero_pedido: pedido.numero_pedido,
            tipo_movimento: "Venda de Mercadorias",
            cliente_nome: pedido.cliente_nome,
            cliente_cpf: pedido.cliente_cpf,
            data_emissao: new Date().toISOString(),
            data_vencimento: new Date().toISOString(),
            data_pagamento: pedido.status === 'Pago' ? new Date().toISOString() : null,
            valor_original: pedido.total,
            valor_liquido: pedido.total,
            forma_pagamento: pedido.forma_pagamento || "PIX",
            parcela: "1/1",
            situacao: pedido.status === 'Pago' ? 'Recebido' : 'Em aberto',
            conta_financeira: "Banco Digital",
            observacoes: `Venda automática do pedido #${pedido.numero_pedido}`
        };
        financeiro.push(novoLancamento);
        writeJSON(FIN_PATH, financeiro);
};

const gerarEntregaLogistica = (pedido) => {
    try {
        const entregas = readJSON(ENTREGAS_PATH);
        const novaEntrega = {
            id: `ENT${Date.now()}`,
            pedido_id: pedido.id,
            numero_pedido: pedido.numero_pedido,
            cliente: {
                nome: pedido.cliente_nome,
                whatsapp: pedido.cliente_whatsapp,
                endereco: pedido.endereco
            },
            profissional_id: null,
            status: "Aguardando Profissional",
            data_criacao: new Date().toISOString(),
            data_limite_aceite: new Date(Date.now() + 5 * 60000).toISOString(),
            logs: [{ status: "Aguardando Profissional", data: new Date().toISOString() }],
            posicao_atual: { lat: null, lng: null }
        };
        entregas.push(novaEntrega);
        writeJSON(ENTREGAS_PATH, entregas);
    } catch (e) {
        console.error("Erro ao gerar logística:", e);
    }
};

// --- ROTAS ---

// 1. CRIAR PEDIDO
const criarPedido = async (req, res) => {
    try {
        const isPdv = req.path === '/pdv';
        const { cliente, itens, frete, subtotal, total, transportadora, transportadoraCodigo, excursao, excursaoCodigo, observacoes } = req.body;
        let pixData = req.body.pixData;
        if (!cliente?.nome || !Array.isArray(itens) || !itens.length || itens.some(i => !i.referencia || !Number.isSafeInteger(Number(i.chosenQty)) || Number(i.chosenQty) <= 0 || !Number.isFinite(Number(i.unitPrice)) || Number(i.unitPrice) < 0) || [frete, subtotal, total].some(v => v == null || !Number.isFinite(Number(v)) || Number(v) < 0)) {
            return res.status(400).json({ success: false, message: 'Cliente, itens ou valores do pedido inválidos.' });
        }
        const desconto = isPdv ? Number(req.body.desconto || 0) : 0;
        const taxas = isPdv ? Number(req.body.taxas || 0) : 0;
        if (isPdv && (!req.body.requestId || !Number.isFinite(desconto) || desconto < 0 || !Number.isFinite(taxas) || taxas < 0 || Math.round((Number(subtotal) - desconto + taxas + Number(frete)) * 100) !== Math.round(Number(total) * 100) || Math.round(itens.reduce((sum, i) => sum + Number(i.unitPrice) * Number(i.chosenQty), 0) * 100) !== Math.round(Number(subtotal) * 100))) {
            return res.status(400).json({ message: 'Valores ou identificação da venda inválidos.' });
        }
        const pagamentos = isPdv ? req.body.pagamentos : [];
        if (isPdv && (!Array.isArray(pagamentos) || !pagamentos.length || pagamentos.some(p => !['Cartão Crédito', 'Cartão Débito', 'PIX', 'Dinheiro', 'Boleto', 'Crédito Loja'].includes(p.method) || !Number.isFinite(Number(p.value)) || Number(p.value) < 0 || !Number.isSafeInteger(Number(p.installments)) || Number(p.installments) < 1) || Math.round(pagamentos.reduce((sum, p) => sum + Number(p.value), 0) * 100) < Math.round(Number(total) * 100))) {
            return res.status(400).json({ message: 'Informe o pagamento completo da venda.' });
        }
        if (!isPdv) {
        if (!pixData?.paymentId) return res.status(400).json({ message: 'Cobrança Pix obrigatória.' });
        const cobranca = await asaas.payment(pixData.paymentId);
        if (cobranca.billingType !== 'PIX' || Math.round(Number(cobranca.value) * 100) !== Math.round(Number(total) * 100) || cobranca.customer == null || cobranca.deleted) return res.status(400).json({ message: 'Cobrança incompatível com o pedido.' });
        }
        const pedidos = readJSON(PEDIDOS_PATH);
        const anterior = isPdv && pedidos.find(p => p.origem === 'pdv' && p.request_id === req.body.requestId);
        if (anterior) return res.json({ success: true, pedido: anterior });
        if (!isPdv && pedidos.some(p => p.asaas_payment_id === pixData.paymentId)) return res.status(409).json({ message: 'Esta cobrança já pertence a um pedido.' });
        const pedidosItens = readJSON(ITENS_PATH);
        const pedidoId = randomUUID();
        if (isPdv) pixData = await asaas.createPix({ nome: cliente.nome, email: cliente.email, cpf: cliente.cpf, valor: total, reference: pedidoId });
        const numeroPedido = pedidos.length + 1;

        const novoPedido = {
            id: pedidoId,
            numero_pedido: numeroPedido,
            data: new Date().toISOString(),
            cliente_nome: cliente.nome,
            cliente_codigo: cliente.codigo,
            origem: isPdv ? 'pdv' : 'ecommerce',
            request_id: isPdv ? req.body.requestId : undefined,
            forma_pagamento: 'PIX',
            pagamentos,
            desconto,
            taxas,
            tipo_cupom: isPdv ? req.body.tipoCupom : undefined,
            integracao: { status: 'pendente' },
            cliente_cpf: cliente.cpf,
            cliente_email: cliente.email,
            cliente_whatsapp: cliente.whatsapp,
            endereco: cliente.endereco,
            // A excursão é a referência selecionada no checkout para o
            // profissional cadastrado como Transportadora.
            excursao: excursao || transportadora,
            excursao_codigo: excursaoCodigo || transportadoraCodigo,
            // Compatibilidade com os pedidos gravados antes do campo excursão.
            transportadora: transportadora || excursao,
            transportadora_codigo: transportadoraCodigo || excursaoCodigo,
            observacoes,
            subtotal,
            frete,
            total,
            status: 'Pendente',
            asaas_payment_id: pixData?.paymentId,
            pix_qr_code: pixData?.qrCode,
            pix_copia_cola: pixData?.copyPaste
        };

        const novosItens = itens.map((item, index) => ({
            id: `${pedidoId}_${index}`,
            pedido_id: pedidoId,
            referencia: item.referencia,
            descricao: item.descricao,
            tamanho: item.chosenSize,
            codigo_cor: item.codigoCor,
            cor: item.chosenColor,
            quantidade: item.chosenQty,
            valor_unitario: item.unitPrice,
            valor_total: Number(item.unitPrice) * Number(item.chosenQty)
        }));

        pedidos.push(novoPedido);
        pedidosItens.push(...novosItens);
        writeJSON(PEDIDOS_PATH, pedidos);
        writeJSON(ITENS_PATH, pedidosItens);
        if (isPdv && (!req.body.tipoCupom || req.body.tipoCupom === 'sem-cupom')) {
            gerarLancamentoFinanceiro(novoPedido);
        }
        novoPedido.integracao = isPdv ? { status: 'local' } : await salesIntegration.send(novoPedido, novosItens);
        // Reload after the network request so concurrent orders/status changes are preserved.
        const atuais = readJSON(PEDIDOS_PATH);
        const atual = atuais.find(p => p.id === pedidoId);
        if (atual) { atual.integracao = novoPedido.integracao; writeJSON(PEDIDOS_PATH, atuais); }
        if (isPdv) {
            try {
                novoPedido.email = await sendOrderEmail({ cliente, itens: itens.map(i => ({ ...i, totalPrice: Number(i.unitPrice) * Number(i.chosenQty) })), total, subtotal, desconto, taxas, numeroPedido, pedidoId, pixData, status: 'Pendente', formaPagamento: 'PIX' });
            } catch (error) {
                novoPedido.email = { status: 'erro', mensagem: error.message };
                console.error('Falha ao enviar e-mail do pedido:', error.message);
            }
            const latest = readJSON(PEDIDOS_PATH);
            const saved = latest.find(p => p.id === pedidoId);
            if (saved) { saved.email = novoPedido.email; writeJSON(PEDIDOS_PATH, latest); }
        }
        res.status(201).json({ success: true, pedido: novoPedido });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
router.post('/', criarPedido);
router.post('/pdv', criarPedido);

const pixLocks = new Set();
const gerarPixPedido = async (req, res) => {
    const id = req.params.id;
    if (pixLocks.has(id)) return res.status(409).json({ message: 'Geração de Pix em andamento. Aguarde.' });
    pixLocks.add(id);
    try {
        const pedido = readJSON(PEDIDOS_PATH).find(p => p.id === id);
        if (!pedido) return res.status(404).json({ message: 'Pedido não encontrado.' });
        if (pedido.status === 'Cancelado') return res.status(409).json({ message: 'Pedido cancelado.' });
        let data;
        if (pedido.asaas_payment_id) {
            const payment = await asaas.payment(pedido.asaas_payment_id);
            if (['RECEIVED', 'CONFIRMED'].includes(payment.status)) {
                if (req.body.regenerate) return res.status(409).json({ message: 'O Asaas já recebeu esta cobrança. Não é possível substituí-la.' });
                return res.json({ success: true, paymentId: pedido.asaas_payment_id, ...(await asaas.pix(pedido.asaas_payment_id)), pedidoId: id, total: pedido.total, paid: true });
            }
            if (req.body.regenerate) {
                if (pedido.status === 'Pago' && req.body.allowPaid !== true) return res.status(409).json({ requiresConfirmation: true, message: 'Este pedido está marcado como recebido. Deseja substituir o Pix pendente por uma nova cobrança?' });
                await asaas.client().delete(`/payments/${pedido.asaas_payment_id}`);
            } else data = { paymentId: pedido.asaas_payment_id, ...(await asaas.pix(pedido.asaas_payment_id)) };
        }
        if (!data) {
            if (pedido.status === 'Pago' && req.body.allowPaid !== true) return res.status(409).json({ requiresConfirmation: true, message: 'Este pedido está marcado como recebido. Gerar Pix criará uma nova cobrança do valor total. Deseja continuar?' });
            data = await asaas.createPix({ nome: pedido.cliente_nome, email: pedido.cliente_email, cpf: pedido.cliente_cpf, valor: pedido.total, reference: pedido.id });
        }
        const pedidos = readJSON(PEDIDOS_PATH);
        const atual = pedidos.find(p => p.id === id);
        Object.assign(atual, { asaas_payment_id: data.paymentId, pix_qr_code: data.qrCode, pix_copia_cola: data.copyPaste });
        writeJSON(PEDIDOS_PATH, pedidos);
        res.json({ success: true, ...data, pedidoId: id, total: pedido.total });
    } catch (error) { res.status(502).json({ message: error.response?.data?.errors?.map(e => e.description).join('; ') || error.message }); }
    finally { pixLocks.delete(id); }
};
router.post('/:id/pix', gerarPixPedido);
router.gerarPixPedido = gerarPixPedido;

router.estornarFinanceiro = (req, res) => {
    try {
        const financeiro = readFinanceiro();
        const entry = financeiro.find(f => String(f.id) === String(req.params.id));
        if (!entry?.id_pedido) return res.status(400).json({ message: 'Este lançamento não possui pedido vinculado.' });
        const pedidos = readJSON(PEDIDOS_PATH);
        const pedido = pedidos.find(p => String(p.id) === String(entry.id_pedido));
        if (!pedido) return res.status(404).json({ message: 'Pedido não encontrado.' });
        if (pedido.status === 'Pago') processarEstornoEstoque(readJSON(ITENS_PATH).filter(i => i.pedido_id === pedido.id));
        pedido.estornos = [...(pedido.estornos || []), { data: new Date().toISOString(), financeiro: entry, asaas_payment_id: pedido.asaas_payment_id, pix_qr_code: pedido.pix_qr_code, pix_copia_cola: pedido.pix_copia_cola }];
        pedido.status = 'Pendente';
        delete pedido.asaas_payment_id;
        delete pedido.pix_qr_code;
        delete pedido.pix_copia_cola;
        writeJSON(PEDIDOS_PATH, pedidos);
        cancelarLancamentoFinanceiro(pedido.id);
        writeJSON(ENTREGAS_PATH, readJSON(ENTREGAS_PATH).filter(e => e.pedido_id !== pedido.id));
        res.json({ success: true, pedido, message: 'Lançamento estornado. Pedido devolvido para Pedidos. O estorno é interno e não devolve valores no Asaas.' });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 2. LISTAR PEDIDOS
// Only configuration failures are safe to resend without remote reconciliation.
router.post('/:id/integracao', async (req, res) => {
    const pedidos = readJSON(PEDIDOS_PATH);
    const pedido = pedidos.find(p => p.id === req.params.id);
    if (!pedido) return res.status(404).json({ message: 'Pedido não encontrado.' });
    if (pedido.status === 'Cancelado' || pedido.integracao?.status !== 'erro_configuracao') return res.status(409).json({ message: 'Reenvio indisponível: confira o registro na integradora.' });
    pedido.integracao = { ...pedido.integracao, status: 'pendente' };
    writeJSON(PEDIDOS_PATH, pedidos);
    try {
        const itens = readJSON(ITENS_PATH).filter(i => i.pedido_id === pedido.id);
        const result = await salesIntegration.send(pedido, itens);
        const atuais = readJSON(PEDIDOS_PATH);
        const atual = atuais.find(p => p.id === pedido.id);
        if (atual) { atual.integracao = result; writeJSON(PEDIDOS_PATH, atuais); }
        res.json({ ...pedido, integracao: result });
    } catch (_) { res.status(500).json({ message: 'Não foi possível concluir o envio. Confira a integração antes de reenviar.' }); }
});

router.get('/', (req, res) => {
    const financeiro = readFinanceiro();
    res.json(readJSON(PEDIDOS_PATH).map(p => ({ ...p, em_financeiro: financeiro.some(f => String(f.id_pedido) === String(p.id)) })));
});

// 3. DETALHES DO PEDIDO
router.get('/:id', (req, res) => {
    const pedidos = readJSON(PEDIDOS_PATH);
    const itens = readJSON(ITENS_PATH);
    const pedido = pedidos.find(p => p.id === req.params.id);
    if (!pedido) return res.status(404).json({ message: "Pedido não encontrado" });
    const itensDoPedido = itens.filter(i => i.pedido_id === req.params.id);
    res.json({ ...pedido, itens: itensDoPedido });
});

// 4. ATUALIZAR STATUS (ONDE A MÁGICA ACONTECE)
router.put('/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!['Pendente', 'Pago', 'Cancelado'].includes(status)) {
        return res.status(400).json({ message: 'Status inválido. Use Pendente, Pago ou Cancelado. O envio é controlado na Logística.' });
    }

    let pedidos = readJSON(PEDIDOS_PATH);
    const index = pedidos.findIndex(p => p.id === id);

    if (index !== -1) {
        if (status === 'Pago' && pedidos[index].asaas_payment_id) {
            try {
                const data = await asaas.payment(pedidos[index].asaas_payment_id);
                if (!asaas.received(data, pedidos[index].total)) return res.status(409).json({ message: 'Aguardando recebimento do Pix no Asaas.', paymentStatus: data.status });
                pedidos = readJSON(PEDIDOS_PATH);
                if (pedidos[index]?.id !== id || pedidos[index].status === 'Cancelado') return res.status(409).json({ message: 'Pedido cancelado ou alterado.' });
            } catch (error) { return res.status(502).json({ message: 'Não foi possível consultar o pagamento no Asaas.' }); }
        }
        const statusAnterior = pedidos[index].status;
        pedidos[index].status = status;
        const itensDoPedido = readJSON(ITENS_PATH).filter(i => i.pedido_id === id);

        if (status === 'Pago') gerarLancamentoFinanceiro(pedidos[index]);
        if (status === 'Cancelado') cancelarLancamentoFinanceiro(id);

        // Se mudou para PAGO
        if (status === 'Pago' && statusAnterior !== 'Pago') {
            processarBaixaEstoque(itensDoPedido);
            gerarEntregaLogistica(pedidos[index]);
        }

        // Se mudou para CANCELADO (e estava pago antes)
        if (status === 'Cancelado' && statusAnterior === 'Pago') {
            processarEstornoEstoque(itensDoPedido);
        }

        writeJSON(PEDIDOS_PATH, pedidos);
        if (status === 'Pago' && statusAnterior !== 'Pago') {
            let notification;
            try {
                if (!pedidos[index].cliente_email) throw new Error('Pedido sem e-mail do cliente. Atualize o cadastro para receber a confirmação.');
                notification = await sendOrderEmail({
                    cliente: { nome: pedidos[index].cliente_nome, email: pedidos[index].cliente_email },
                    itens: itensDoPedido.map(i => ({ descricao: i.descricao, chosenColor: i.cor, codigoCor: i.codigo_cor, chosenSize: i.tamanho, chosenQty: i.quantidade, totalPrice: i.valor_total })),
                    numeroPedido: pedidos[index].numero_pedido,
                    subtotal: pedidos[index].subtotal ?? pedidos[index].total,
                    total: pedidos[index].total, desconto: pedidos[index].desconto, taxas: pedidos[index].taxas,
                    formaPagamento: pedidos[index].forma_pagamento || 'PIX', status: 'Pago'
                });
            } catch (error) {
                notification = { status: 'erro', mensagem: error.message };
                console.error('Falha no e-mail de confirmação:', error.message);
            }
            const latest = readJSON(PEDIDOS_PATH);
            const saved = latest.find(p => p.id === id);
            if (saved) { saved.email_confirmacao = notification; writeJSON(PEDIDOS_PATH, latest); }
            pedidos[index].email_confirmacao = notification;
        }
        res.json(pedidos[index]);
    } else {
        res.status(404).json({ message: "Pedido não encontrado" });
    }
});

// 5. EXCLUIR PEDIDO
router.delete('/:id', (req, res) => {
    let pedidos = readJSON(PEDIDOS_PATH);
    let itens = readJSON(ITENS_PATH);
    pedidos = pedidos.filter(p => p.id !== req.params.id);
    itens = itens.filter(i => i.pedido_id !== req.params.id);
    writeJSON(PEDIDOS_PATH, pedidos);
    writeJSON(ITENS_PATH, itens);
    res.json({ message: "Pedido removido" });
});

module.exports = router;
