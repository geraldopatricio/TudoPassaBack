const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

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

const cancelarLancamentoFinanceiro = (pedidoId) => {
    try {
        let financeiro = readJSON(FIN_PATH);
        const index = financeiro.findIndex(f => f.id_pedido === pedidoId);
        if (index !== -1) {
            financeiro[index].situacao = 'Cancelado';
            financeiro[index].observacoes += ` | Pedido cancelado em ${new Date().toLocaleString()}`;
            writeJSON(FIN_PATH, financeiro);
        }
    } catch (e) {
        console.error("Erro ao cancelar financeiro:", e);
    }
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
    try {
        const financeiro = readJSON(FIN_PATH);
        if (financeiro.some(f => f.id_pedido === pedido.id)) return;
        const novoLancamento = {
            id: `FIN${Date.now()}`,
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
    } catch (e) {
        console.error("Erro ao gerar financeiro:", e);
    }
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
router.post('/', (req, res) => {
    try {
        const { cliente, itens, frete, subtotal, total, transportadora, observacoes, pixData } = req.body;
        const pedidos = readJSON(PEDIDOS_PATH);
        const pedidosItens = readJSON(ITENS_PATH);
        const pedidoId = Date.now().toString();
        const numeroPedido = pedidos.length + 1;

        const novoPedido = {
            id: pedidoId,
            numero_pedido: numeroPedido,
            data: new Date().toISOString(),
            cliente_nome: cliente.nome,
            cliente_cpf: cliente.cpf,
            cliente_email: cliente.email,
            cliente_whatsapp: cliente.whatsapp,
            endereco: cliente.endereco,
            transportadora,
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
            quantidade: item.chosenQty,
            valor_unitario: item.unitPrice,
            valor_total: item.totalPrice
        }));

        pedidos.push(novoPedido);
        pedidosItens.push(...novosItens);
        writeJSON(PEDIDOS_PATH, pedidos);
        writeJSON(ITENS_PATH, pedidosItens);
        res.status(201).json({ success: true, pedido: novoPedido });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. LISTAR PEDIDOS
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

    let pedidos = readJSON(PEDIDOS_PATH);
    const index = pedidos.findIndex(p => p.id === id);

    if (index !== -1) {
        const statusAnterior = pedidos[index].status;
        pedidos[index].status = status;
        const itensDoPedido = readJSON(ITENS_PATH).filter(i => i.pedido_id === id);

        // Se mudou para PAGO
        if (status === 'Pago' && statusAnterior !== 'Pago') {
            processarBaixaEstoque(itensDoPedido);
            gerarLancamentoFinanceiro(pedidos[index]);
            gerarEntregaLogistica(pedidos[index]);
        }

        // Se mudou para CANCELADO (e estava pago antes)
        if (status === 'Cancelado' && statusAnterior === 'Pago') {
            processarEstornoEstoque(itensDoPedido);
            cancelarLancamentoFinanceiro(id);
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