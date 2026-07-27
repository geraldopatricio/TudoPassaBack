const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const ENTREGAS_PATH = path.join(__dirname, '../database/logistica/entregas.json');
const PROFISSIONAIS_PATH = path.join(__dirname, '../database/profissionais/profissionais.json');
const USUARIOS_PATH = path.join(__dirname, '../database/usuarios/usuarios.json');
const EVIDENCIAS_PATH = path.join(__dirname, '../database/logistica/uploads/');
const AUTH_SECRET = process.env.AUTH_SECRET || 'tudo-passa-local-auth-secret';

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf-8') || '[]');
const writeJSON = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

if (!fs.existsSync(EVIDENCIAS_PATH)) fs.mkdirSync(EVIDENCIAS_PATH, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, EVIDENCIAS_PATH),
        filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
    }),
    limits: { files: 6, fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/'))
});

const requireAdmin = (req, res, next) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ message: 'Autenticação de administrador obrigatória.' });

    const [payload, signature] = token.split('.');
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload || '').digest('base64url');
    if (!payload || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return res.status(401).json({ message: 'Sessão inválida.' });
    }

    try {
        const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const usuario = readJSON(USUARIOS_PATH).find(u => u.login === session.login);
        if (!usuario || usuario.tipo !== 'Admin') return res.status(403).json({ message: 'Apenas usuários Admin podem alterar rastreios.' });
        req.admin = usuario;
        next();
    } catch (_error) {
        return res.status(401).json({ message: 'Sessão inválida.' });
    }
};

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
    if (entrega) {
        res.json(entrega);
    } else {
        res.status(404).json({ error: 'Rastreamento não encontrado para o pedido.' });
    }
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

// Atualização operacional e evidências: restrita a administradores.
router.put('/admin/entregas/:entregaId', requireAdmin, upload.fields([
    { name: 'fotos', maxCount: 5 },
    { name: 'assinatura', maxCount: 1 }
]), (req, res) => {
    const statusPermitidos = ['Aguardando Profissional', 'Aceito - Em Coleta', 'Em Rota', 'Entregue', 'Não Entregue'];
    const { status, tipo_evidencia, observacao } = req.body;
    if (!statusPermitidos.includes(status)) return res.status(400).json({ message: 'Status logístico inválido.' });

    const entregas = readJSON(ENTREGAS_PATH);
    const index = entregas.findIndex(e => e.id === req.params.entregaId);
    if (index === -1) return res.status(404).json({ message: 'Entrega não encontrada.' });

    const fotos = (req.files?.fotos || []).map(file => file.filename);
    const assinatura = req.files?.assinatura?.[0]?.filename || null;
    const possuiEvidencia = fotos.length > 0 || assinatura || observacao?.trim();
    const entrega = entregas[index];
    entrega.status = status;
    entrega.logs = entrega.logs || [];
    entrega.logs.push({ status, data: new Date().toISOString(), alterado_por: req.admin.login });
    entrega.evidencias = entrega.evidencias || [];
    if (possuiEvidencia) {
        entrega.evidencias.push({
            id: `EVD${Date.now()}`,
            tipo: tipo_evidencia === 'nao_entrega' ? 'Não entrega' : 'Entrega',
            observacao: observacao?.trim() || '',
            fotos,
            assinatura,
            criado_em: new Date().toISOString(),
            criado_por: req.admin.login
        });
    }

    writeJSON(ENTREGAS_PATH, entregas);
    res.json(entrega);
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
