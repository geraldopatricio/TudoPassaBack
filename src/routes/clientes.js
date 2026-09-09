const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const integration = require('../services/integrationService');

// --- CONFIGURAÇÃO DE CAMINHOS ---
const DB_PATH = path.join(__dirname, '../database/clientes/clientes.json');
const UPLOAD_PATH = path.join(__dirname, '../database/clientes/uploads/');

// Garantir que a pasta de uploads exista
if (!fs.existsSync(UPLOAD_PATH)) {
    fs.mkdirSync(UPLOAD_PATH, { recursive: true });
}

// --- CONFIGURAÇÃO DO MULTER (UPLOAD DE FOTO) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_PATH);
    },
    filename: (req, file, cb) => {
        // Nome único: timestamp-nomeoriginal
        const uniqueSuffix = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
        cb(null, uniqueSuffix);
    }
});

const upload = multer({ storage: storage });

// --- FUNÇÕES AUXILIARES DE BANCO DE DADOS ---
const readDB = () => {
    try {
        if (!fs.existsSync(DB_PATH)) {
            const dir = path.dirname(DB_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(DB_PATH, '[]');
            return [];
        }
        const data = fs.readFileSync(DB_PATH, 'utf-8');
        return JSON.parse(data || '[]');
    } catch (error) {
        console.error("Erro ao ler banco de clientes:", error);
        return [];
    }
};

const writeDB = (data) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// Auxiliar para converter dados do FormData (que vêm como string) para Array
const parseArray = (data) => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    try {
        return JSON.parse(data); // Se o frontend enviou JSON.stringify
    } catch (e) {
        return data.split(',').map(item => item.trim()); // Se enviou string separada por vírgula
    }
};

// --- ROTAS CRUD ---

// 1. LISTAR TODOS
router.get('/', async (req, res) => {
    try {
        const remote = await integration.list('clientes');
        if (!remote) return res.json(readDB());
        const local = readDB();
        res.json(remote.map(item => ({ ...item, ...(local.find(saved => String(saved.codigo) === String(item.codigo)) || {}), codigo: item.codigo })));
    }
    catch (error) { res.status(502).json({ message: 'Erro ao consultar integração de clientes', error: error.message }); }
});

// 2. BUSCAR POR CÓDIGO
router.get('/:codigo', async (req, res) => {
    try {
        const remote = await integration.getOne('clientes', req.params.codigo);
        if (remote) {
            const local = readDB().find(saved => String(saved.codigo) === String(req.params.codigo));
            return res.json({ ...remote, ...(local || {}), codigo: remote.codigo });
        }
    }
    catch (error) { return res.status(502).json({ message: error.message }); }
    const clientes = readDB();
    const cliente = clientes.find(c => c.codigo.toString() === req.params.codigo.toString());
    if (!cliente) return res.status(404).json({ message: "Cliente não encontrado" });
    res.json(cliente);
});

// 3. CADASTRAR (POST)
router.post('/', upload.single('foto'), (req, res) => {
    try {
        const remote = awaitRemote('post', null, req.body);
        if (remote) return remote.then(data => res.status(201).json(data)).catch(error => res.status(502).json({ message: error.message }));
        const clientes = readDB();
        const { codigo, cpf_cnpj } = req.body;

        // Verifica duplicidade
        if (clientes.find(c => c.codigo.toString() === codigo.toString())) {
            return res.status(400).json({ message: "Este código de cliente já existe." });
        }

        const novoCliente = {
            ...req.body,
            // Tratamento de tipos específicos
            codigo: req.body.codigo,
            credito_limite: parseFloat(req.body.credito_limite || 0),
            credito_atual: parseFloat(req.body.credito_atual || 0),
            bloqueado: req.body.bloqueado === 'true' || req.body.bloqueado === true,
            formas_pagamento: parseArray(req.body.formas_pagamento),
            cartoes_loja: parseArray(req.body.cartoes_loja),
            ref_usuarios: parseArray(req.body.ref_usuarios),
            foto: req.file ? req.file.filename : null,
            data_cadastro: new Date().toISOString()
        };

        clientes.push(novoCliente);
        writeDB(clientes);

        res.status(201).json(novoCliente);
    } catch (error) {
        res.status(400).json({ message: "Erro ao cadastrar cliente", error: error.message });
    }
});

// 4. ATUALIZAR (PUT)
router.put('/:codigo', upload.single('foto'), (req, res) => {
    const { codigo } = req.params;
    let clientes = readDB();
    let index = clientes.findIndex(c => c.codigo.toString() === codigo.toString());

    if (index === -1) {
        const config = integration.readConfig();
        if (!config.enabled || config.provider === 'local') return res.status(404).json({ message: 'Registro nao encontrado' });
        clientes.push({ codigo: codigo, data_cadastro: new Date().toISOString() });
        index = clientes.length - 1;
    }

    // Se enviou uma nova foto, tenta apagar a antiga para economizar espaço
    if (req.file && clientes[index].foto) {
        const antigaPath = path.join(UPLOAD_PATH, clientes[index].foto);
        if (fs.existsSync(antigaPath)) fs.unlinkSync(antigaPath);
    }

    // Mesclar dados antigos com novos
    clientes[index] = {
        ...clientes[index],
        ...req.body,
        // Garantir tipos corretos
        credito_limite: parseFloat(req.body.credito_limite ?? clientes[index].credito_limite ?? 0),
        credito_atual: parseFloat(req.body.credito_atual ?? clientes[index].credito_atual ?? 0),
        bloqueado: req.body.bloqueado === undefined ? (clientes[index].bloqueado ?? false) : req.body.bloqueado === 'true' || req.body.bloqueado === true,
        formas_pagamento: req.body.formas_pagamento ? parseArray(req.body.formas_pagamento) : clientes[index].formas_pagamento,
        cartoes_loja: req.body.cartoes_loja ? parseArray(req.body.cartoes_loja) : clientes[index].cartoes_loja,
        ref_usuarios: req.body.ref_usuarios ? parseArray(req.body.ref_usuarios) : clientes[index].ref_usuarios,
        foto: req.file ? req.file.filename : (req.body.foto ?? clientes[index].foto),
        codigo: clientes[index].codigo, // Protege o ID original
        data_cadastro: clientes[index].data_cadastro // Protege a data original
    };

    writeDB(clientes);
    res.json(clientes[index]);
});

// 5. EXCLUIR (DELETE)
router.delete('/:codigo', (req, res) => {
    const { codigo } = req.params;
    let clientes = readDB();
    const cliente = clientes.find(c => c.codigo.toString() === codigo.toString());

    if (!cliente) return res.status(404).json({ message: "Cliente não encontrado" });

    // Remove a foto do disco
    if (cliente.foto) {
        const fotoPath = path.join(UPLOAD_PATH, cliente.foto);
        if (fs.existsSync(fotoPath)) fs.unlinkSync(fotoPath);
    }

    const novosClientes = clientes.filter(c => c.codigo.toString() !== codigo.toString());
    writeDB(novosClientes);
    res.json({ message: "Cliente excluído com sucesso" });
});

module.exports = router;

function awaitRemote(method, id, body) {
    const config = integration.readConfig();
    if (!config.enabled || !config.resources?.clientes?.[method]) return null;
    return integration.writeRemote('clientes', method, id, body);
}
