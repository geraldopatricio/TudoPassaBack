const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const integration = require('../services/integrationService');

const DB_PATH = path.join(__dirname, '../database/produtos/produtos.json');
const UPLOAD_PATH = path.join(__dirname, '../database/produtos/uploads/');

// Configuração do Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });
        cb(null, UPLOAD_PATH);
    },
    filename: (req, file, cb) => {
        // Usa a referência do corpo da requisição para nomear o arquivo
        // Ex: 1715036.jpeg
        const ref = req.body.referencia || Date.now();
        const ext = path.extname(file.originalname) || '.jpeg';
        cb(null, `${ref}${ext}`);
    }
});
const upload = multer({ storage });

const readDB = () => {
    try {
        if (!fs.existsSync(DB_PATH)) return [];
        const data = fs.readFileSync(DB_PATH, 'utf-8');
        return JSON.parse(data || '[]');
    } catch (e) { return []; }
};

const writeDB = (data) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// 1. LISTAR TODOS
router.get('/', async (req, res) => {
    try {
        const remote = await integration.list('produtos');
        if (!remote) return res.json(readDB());
        const local = readDB();
        res.json(remote.map(item => ({ ...item, ...(local.find(saved => String(saved.referencia) === String(item.referencia)) || {}), referencia: item.referencia })));
    }
    catch (error) { res.status(502).json({ message: 'Erro ao consultar integração de produtos', error: error.message }); }
});

router.post('/', upload.single('imagem'), (req, res) => {
    try {
        const remote = awaitRemote('produtos', 'post', null, req.body);
        if (remote) return remote.then(data => res.status(201).json(data)).catch(error => res.status(502).json({ message: error.message }));
        const produtos = readDB();
        const { referencia } = req.body;

        if (produtos.find(p => p.referencia === referencia)) {
            return res.status(400).json({ message: "Essa referência já existe no sistema!" });
        }

        let variantesProcessadas = [];
        if (req.body.variantes) {
            const variantesRaw = typeof req.body.variantes === 'string' 
                ? JSON.parse(req.body.variantes) 
                : req.body.variantes;

            // Mapeia as variantes garantindo que todos os campos de preço existam
            variantesProcessadas = variantesRaw.map(v => ({
                ...v,
                // Originais
                valor_unitario: Number(v.valor_unitario) || 0,
                valor_total: Number(v.valor_total) || 0,
                // Novas Tabelas
                valor_unitario_tb1: Number(v.valor_unitario_tb1) || 0,
                valor_total_tb1: Number(v.valor_total_tb1) || 0,
                valor_unitario_tb2: Number(v.valor_unitario_tb2) || 0,
                valor_total_tb2: Number(v.valor_total_tb2) || 0,
                valor_unitario_tb3: Number(v.valor_unitario_tb3) || 0,
                valor_total_tb3: Number(v.valor_total_tb3) || 0
            }));
        }

        const novoProduto = {
            referencia: req.body.referencia,
            categoria: req.body.categoria || 'CAMISA',
            descricao: req.body.descricao || '',
            unidade: req.body.unidade || 'UN',
            imagem: req.file ? req.file.filename : 'avatar.png',
            variantes: variantesProcessadas
        };

        produtos.push(novoProduto);
        writeDB(produtos);
        res.status(201).json(novoProduto);
    } catch (error) {
        console.error("Erro interno no cadastro:", error);
        res.status(400).json({ message: "Erro ao processar dados", error: error.message });
    }
});

// 3. EDITAR
router.put('/:ref', upload.single('imagem'), (req, res) => {
    const { ref } = req.params;
    const remote = awaitRemote('produtos', 'put', ref, req.body);
    if (remote) return remote.then(data => res.json(data)).catch(error => res.status(502).json({ message: error.message }));
    let produtos = readDB();
    const index = produtos.findIndex(p => p.referencia === ref);

    if (index === -1) {
        const config = integration.readConfig();
        if (config.enabled) {
            const novo = { ...req.body, referencia: ref, variantes: req.body.variantes ? (typeof req.body.variantes === 'string' ? JSON.parse(req.body.variantes) : req.body.variantes) : [] };
            produtos.push(novo); writeDB(produtos); return res.status(201).json(novo);
        }
        return res.status(404).json({ message: "Produto não encontrado" });
    }

    // Processar variantes se elas vierem no corpo da requisição
    let variantesAtualizadas = produtos[index].variantes;
    if (req.body.variantes) {
        const vRaw = typeof req.body.variantes === 'string' ? JSON.parse(req.body.variantes) : req.body.variantes;
        variantesAtualizadas = vRaw.map(v => ({
            ...v,
            valor_unitario: Number(v.valor_unitario) || 0,
            valor_total: Number(v.valor_total) || 0,
            valor_unitario_tb1: Number(v.valor_unitario_tb1) || 0,
            valor_total_tb1: Number(v.valor_total_tb1) || 0,
            valor_unitario_tb2: Number(v.valor_unitario_tb2) || 0,
            valor_total_tb2: Number(v.valor_total_tb2) || 0,
            valor_unitario_tb3: Number(v.valor_unitario_tb3) || 0,
            valor_total_tb3: Number(v.valor_total_tb3) || 0
        }));
    }

    const produtoAtualizado = {
        ...produtos[index],
        ...req.body,
        variantes: variantesAtualizadas
    };

    if (req.file) {
        produtoAtualizado.imagem = req.file.filename;
    }

    produtos[index] = produtoAtualizado;
    writeDB(produtos);
    res.json(produtoAtualizado);
});

// 4. EXCLUIR
router.delete('/:ref', (req, res) => {
    const { ref } = req.params;
    let produtos = readDB();
    const produto = produtos.find(p => p.referencia === ref);

    if (!produto) return res.status(404).json({ message: "Produto não encontrado" });

    // Exclui a imagem física
    if (produto.imagem && produto.imagem !== 'avatar.png') {
        const imgPath = path.join(UPLOAD_PATH, produto.imagem);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    const novosProdutos = produtos.filter(p => p.referencia !== ref);
    writeDB(novosProdutos);
    res.json({ message: "Excluído com sucesso" });
});

module.exports = router;

function awaitRemote(resource, method, id, body) {
    const config = integration.readConfig();
    if (!config.enabled || !config.resources?.[resource]?.[method]) return null;
    return integration.writeRemote(resource, method, id, body);
}
