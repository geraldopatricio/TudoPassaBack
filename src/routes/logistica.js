const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const ENTREGAS_PATH = path.join(__dirname, '../database/logistica/entregas.json');
const PROFISSIONAIS_PATH = path.join(__dirname, '../database/profissionais/profissionais.json');

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf-8') || '[]');
const writeJSON = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

// 1. CRIAR ENTREGA (Chamado pelo Pedido quando status virar PAGO)
router.post('/gerar', (req, res) => {
    const { pedido } = req.body;
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
        data_limite_aceite: new Date(Date.now() + 5 * 60000).toISOString(), // +5 minutos
        logs: [{ status: "Aguardando Profissional", data: new Date().toISOString() }]
    };

    entregas.push(novaEntrega);
    writeJSON(ENTREGAS_PATH, entregas);
    res.json(novaEntrega);
});

// 2. PROFISSIONAL ACEITAR ENTREGA
router.put('/aceitar/:entregaId', (req, res) => {
    const { profissionalId } = req.body;
    let entregas = readJSON(ENTREGAS_PATH);
    const index = entregas.findIndex(e => e.id === req.params.entregaId);

    if (index === -1) return res.status(404).json({ message: "Entrega não encontrada" });

    // Verifica se já passou os 5 minutos ou se alguém já aceitou
    if (entregas[index].profissional_id) return res.status(400).json({ message: "Esta entrega já foi aceita por outro profissional." });

    entregas[index].profissional_id = profissionalId;
    entregas[index].status = "Aceito - Em Coleta";
    entregas[index].logs.push({ status: "Aceito", profissionalId, data: new Date().toISOString() });

    writeJSON(ENTREGAS_PATH, entregas);
    res.json(entregas[index]);
});

// 3. ATUALIZAR POSIÇÃO GPS (Chamado pelo App do Profissional em movimento)
router.post('/rastreio/posicao', (req, res) => {
    const { profissionalId, lat, lng } = req.body;
    let entregas = readJSON(ENTREGAS_PATH);

    // Atualiza todas as entregas ativas deste profissional
    entregas = entregas.map(e => {
        if (e.profissional_id === profissionalId && e.status !== "Entregue") {
            return { ...e, posicao_atual: { lat, lng } };
        }
        return e;
    });

    writeJSON(ENTREGAS_PATH, entregas);
    res.json({ success: true });
});

// 4. MUDAR STATUS (Coletado, Em Rota, Entregue)
router.put('/status/:entregaId', (req, res) => {
    const { status } = req.body;
    let entregas = readJSON(ENTREGAS_PATH);
    const index = entregas.findIndex(e => e.id === req.params.entregaId);

    entregas[index].status = status;
    entregas[index].logs.push({ status, data: new Date().toISOString() });

    writeJSON(ENTREGAS_PATH, entregas);
    res.json(entregas[index]);
});

router.get('/disponiveis', (req, res) => {
    try {
        const entregas = readJSON(ENTREGAS_PATH);
        // Retorna apenas pedidos sem motorista e que estão aguardando
        const disponiveis = entregas.filter(e => e.status === "Aguardando Profissional" && !e.profissional_id);
        res.json(disponiveis);
    } catch (e) { res.json([]); }
});

// Rota para o cliente ou motorista ver uma entrega específica
router.get('/rastreio/:pedidoId', (req, res) => {
    const entregas = readJSON(ENTREGAS_PATH);
    const entrega = entregas.find(e => e.pedido_id === req.params.pedidoId);
    res.json(entrega || {});
});

router.get('/cliente/:documento', (req, res) => {
    const entregas = readJSON(ENTREGAS_PATH);
    const entregasDoCliente = entregas.filter(e => e.cliente.cpf === req.params.documento);
    res.json(entregasDoCliente);
});

// B. VISÃO GESTOR: Busca tudo para o painel de controle
router.get('/admin/monitoramento', (req, res) => {
    const entregas = readJSON(ENTREGAS_PATH);
    res.json(entregas);
});


router.get('/disponiveis', (req, res) => {
    let entregas = readJSON(ENTREGAS_PATH);
    const agora = new Date();

    entregas.forEach(e => {
        if (e.status === "Aguardando Profissional" && !e.profissional_id) {
            const dataLimite = new Date(e.data_limite_aceite);
            if (agora > dataLimite) {
                // Lógica de redirecionamento: 
                // Aqui você poderia mudar a prioridade ou enviar para um grupo VIP
                e.logs.push({ status: "Tempo Excedido - Redirecionando", data: agora });
                e.data_limite_aceite = new Date(agora.getTime() + 5 * 60000).toISOString();
            }
        }
    });
    writeJSON(ENTREGAS_PATH, entregas);
    res.json(entregas.filter(e => !e.profissional_id));
});


module.exports = router;