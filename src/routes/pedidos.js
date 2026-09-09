const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
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
                const variante = produtos[pIndex].variantes[0];
                const tamanho = item.tamanho;
                if (variante.grade[tamanho] !== undefined) {
                    variante.grade[tamanho] -= Number(item.quantidade);
                    if (variante.grade[tamanho] < 0) variante.grade[tamanho] = 0;
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
                const variante = produtos[pIndex].variantes[0];
                const tamanho = item.tamanho;
                if (variante.grade[tamanho] !== undefined) {
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
        if (financeiro.some(f => String(f.id_pedido) === String(pedido.id))) return;
        const novoLancamento = {
            id: `FIN${randomUUID()}`,
            id_pedido: pedido.id,
            numero_pedido: pedido.numero_pedido,
            tipo_movimento: "Venda de Mercadorias",
            cliente_nome: pedido.cliente_nome,
            cliente_cpf: pedido.cliente_cpf,
            data_emissao: new Date().toISOString(),
            data_vencimento: new Date().toISOString(),
            data_pagamento: new Date().toISOString(),
            valor_original: pedido.total,
            valor_liquido: pedido.total,
            forma_pagamento: pedido.forma_pagamento || "PIX",
            parcela: "1/1",
            situacao: "Recebido",
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
router.post('/', async (req, res) => {
    try {
        const { cliente, itens, frete, subtotal, total, transportadora, transportadoraCodigo, excursao, excursaoCodigo, observacoes, pixData } = req.body;
        if (!cliente?.nome || !Array.isArray(itens) || !itens.length || itens.some(i => !i.referencia || !Number.isSafeInteger(Number(i.chosenQty)) || Number(i.chosenQty) <= 0 || !Number.isFinite(Number(i.unitPrice)) || Number(i.unitPrice) < 0) || [frete, subtotal, total].some(v => v == null || !Number.isFinite(Number(v)) || Number(v) < 0)) {
            return res.status(400).json({ success: false, message: 'Cliente, itens ou valores do pedido inválidos.' });
        }
        const pedidos = readJSON(PEDIDOS_PATH);
        const pedidosItens = readJSON(ITENS_PATH);
        const pedidoId = randomUUID();
        const numeroPedido = pedidos.length + 1;

        const novoPedido = {
            id: pedidoId,
            numero_pedido: numeroPedido,
            data: new Date().toISOString(),
            cliente_nome: cliente.nome,
            cliente_codigo: cliente.codigo,
            forma_pagamento: 'PIX',
            desconto: 0,
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
            quantidade: item.chosenQty,
            valor_unitario: item.unitPrice,
            valor_total: item.totalPrice
        }));

        pedidos.push(novoPedido);
        pedidosItens.push(...novosItens);
        writeJSON(PEDIDOS_PATH, pedidos);
        writeJSON(ITENS_PATH, pedidosItens);
        novoPedido.integracao = await salesIntegration.send(novoPedido, novosItens);
        // Reload after the network request so concurrent orders/status changes are preserved.
        const atuais = readJSON(PEDIDOS_PATH);
        const atual = atuais.find(p => p.id === pedidoId);
        if (atual) { atual.integracao = novoPedido.integracao; writeJSON(PEDIDOS_PATH, atuais); }
        res.status(201).json({ success: true, pedido: novoPedido });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

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
    res.json(readJSON(PEDIDOS_PATH));
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
router.put('/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!['Pendente', 'Pago', 'Cancelado'].includes(status)) {
        return res.status(400).json({ message: 'Status inválido. Use Pendente, Pago ou Cancelado. O envio é controlado na Logística.' });
    }

    let pedidos = readJSON(PEDIDOS_PATH);
    const index = pedidos.findIndex(p => p.id === id);

    if (index !== -1) {
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
