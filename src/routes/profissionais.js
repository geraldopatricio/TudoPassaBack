const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const integration = require('../services/integrationService');

// Caminhos
const DB_PATH = path.join(__dirname, '../database/profissionais/profissionais.json');
const UPLOAD_PATH = path.join(__dirname, '../database/profissionais/uploads/');

// --- CONFIGURAÇÃO DO MULTER (UPLOAD LOGOMARCA) ---
if (!fs.existsSync(UPLOAD_PATH)) {
    fs.mkdirSync(UPLOAD_PATH, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_PATH);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + file.originalname.replace(/\s/g, '_');
        cb(null, uniqueSuffix);
    }
});

const upload = multer({ storage: storage });

// --- FUNÇÕES AUXILIARES ---
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
        console.error("Erro ao ler banco de dados de profissionais:", error);
        return [];
    }
};

const writeDB = (data) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// Auxiliar para converter strings vindo do form-data em arrays
const parseArray = (data) => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    try {
        return JSON.parse(data); // Se vier como string "[1,2]"
    } catch (e) {
        return data.split(',').map(item => item.trim()); // Se vier como "1,2,3"
    }
};

// --- ROTAS CRUD ---

// 1. LISTAR TODOS
router.get('/', async (req, res) => {
    try {
        const remote = await integration.list('profissionais');
        if (!remote) return res.json(readDB());
        const local = readDB();
        res.json(remote.map(item => ({ ...item, ...(local.find(saved => String(saved.codigo) === String(item.codigo)) || {}), codigo: item.codigo })));
    }
    catch (error) { res.status(502).json({ message: 'Erro ao consultar integração de profissionais', error: error.message }); }
});

// 2. BUSCAR POR CÓDIGO
router.get('/:codigo', async (req, res) => {
    try { const remote = await integration.getOne('profissionais', req.params.codigo); if (remote) return res.json({ ...remote, ...(readDB().find(p => String(p.codigo) === String(req.params.codigo)) || {}), codigo: remote.codigo }); }
    catch (error) { return res.status(502).json({ message: error.message }); }
    const profissionais = readDB();
    const prof = profissionais.find(p => p.codigo === req.params.codigo);
    if (!prof) return res.status(404).json({ message: "Profissional não encontrado" });
    res.json(prof);
});

// 3. CADASTRAR
router.post('/', upload.single('logomarca'), (req, res) => {
    try {
        const remote = awaitRemote('post', null, req.body);
        if (remote) return remote.then(data => res.status(201).json(data)).catch(error => res.status(502).json({ message: error.message }));
        const profissionais = readDB();
        const {
            codigo, nome, cpf_cnpj, celular, email, endereco,
            numero, bairro, cidade, uf, cep, tipo, ref_clientes, ref_produtos, ref_usuarios
        } = req.body;

        if (profissionais.find(p => p.codigo === codigo)) {
            return res.status(400).json({ message: "Este código já está em uso." });
        }

        const novoProfissional = {
            codigo,
            nome,
            cpf_cnpj,
            celular,
            email,
            endereco,
            numero,
            bairro,
            cidade,
            uf,
            cep,
            tipo, // Cliente, Transportadora, Vendedor, etc.
            logomarca: req.file ? req.file.filename : null,
            // Tratamento para campos que podem vir como array ou string do frontend
            ref_clientes: parseArray(ref_clientes),
            ref_produtos: parseArray(ref_produtos),
            ref_usuarios: parseArray(ref_usuarios),
            data_cadastro: new Date().toISOString()
        };

        profissionais.push(novoProfissional);
        writeDB(profissionais);

        res.status(201).json(novoProfissional);
    } catch (error) {
        res.status(400).json({ message: "Erro ao cadastrar profissional", error: error.message });
    }
});

// 4. EDITAR
router.put('/:codigo', upload.single('logomarca'), (req, res) => {
    const { codigo } = req.params;
    let profissionais = readDB();
    let index = profissionais.findIndex(p => String(p.codigo) === String(codigo));

    if (index === -1) {
        const config = integration.readConfig();
        if (!config.enabled || config.provider === 'local') return res.status(404).json({ message: 'Registro nao encontrado' });
        profissionais.push({ codigo: codigo, data_cadastro: new Date().toISOString(), tipo: req.body.tipo || config.resources?.profissionais?.tipo || 'fornecedor' });
        index = profissionais.length - 1;
    }

    // Gerenciar troca de logomarca (apagar antiga se houver nova)
    if (req.file && profissionais[index].logomarca) {
        const antigaPath = path.join(UPLOAD_PATH, profissionais[index].logomarca);
        if (fs.existsSync(antigaPath)) fs.unlinkSync(antigaPath);
    }

    // Atualizar dados
    const atualizado = {
        ...profissionais[index],
        ...req.body,
        // Garante que campos de array sejam processados corretamente
        ref_clientes: req.body.ref_clientes ? parseArray(req.body.ref_clientes) : profissionais[index].ref_clientes,
        ref_produtos: req.body.ref_produtos ? parseArray(req.body.ref_produtos) : profissionais[index].ref_produtos,
        ref_usuarios: req.body.ref_usuarios ? parseArray(req.body.ref_usuarios) : profissionais[index].ref_usuarios,
        logomarca: req.file ? req.file.filename : (req.body.logomarca ?? profissionais[index].logomarca),
        codigo: profissionais[index].codigo, // Impede alterar o código ID via PUT
        data_cadastro: profissionais[index].data_cadastro
    };

    profissionais[index] = atualizado;
    writeDB(profissionais);
    res.json(atualizado);
});

// 5. EXCLUIR
router.delete('/:codigo', (req, res) => {
    const { codigo } = req.params;
    let profissionais = readDB();
    const prof = profissionais.find(p => p.codigo === codigo);

    if (!prof) return res.status(404).json({ message: "Profissional não encontrado" });

    // Remover arquivo de logomarca
    if (prof.logomarca) {
        const fotoPath = path.join(UPLOAD_PATH, prof.logomarca);
        if (fs.existsSync(fotoPath)) fs.unlinkSync(fotoPath);
    }

    const novosProfissionais = profissionais.filter(p => p.codigo !== codigo);
    writeDB(novosProfissionais);
    res.json({ message: "Profissional excluído com sucesso" });
});

module.exports = router;

function awaitRemote(method, id, body) {
    const config = integration.readConfig();
    if (!config.enabled || !config.resources?.profissionais?.[method]) return null;
    return integration.writeRemote('profissionais', method, id, body);
}
