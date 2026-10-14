const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const integration = require('../services/integrationService');
const { randomUUID } = require('crypto');

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
        const ext = path.extname(file.originalname) || '.jpeg';
        cb(null, `${randomUUID()}${ext}`);
    }
});
const upload = multer({ storage, limits: { files: 6, fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const valid = /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype) && /\.(jpe?g|png|webp|gif|avif)$/i.test(file.originalname);
        cb(valid ? null : new Error('Envie imagens JPG, PNG, WebP, GIF ou AVIF.'), valid);
    }
});
const cleanupUploads = req => Object.values(req.files || {}).flat().forEach(file => { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); });
const receivePhotos = (req, res, next) => upload.fields([{ name: 'imagens', maxCount: 6 }, { name: 'imagem', maxCount: 1 }])(req, res, error => {
    if (error) return res.status(400).json({ message: error.message });
    next();
});
const photoNames = p => Array.isArray(p.imagens) ? p.imagens : (p.imagem && p.imagem !== 'avatar.png' ? [p.imagem] : []);
const mediaFields = (req, previous = {}) => {
    const existing = photoNames(previous);
    const retained = req.body.imagens_existentes === undefined ? existing : JSON.parse(req.body.imagens_existentes);
    if (!Array.isArray(retained) || retained.some(name => !existing.includes(name))) throw new Error('Seleção de fotos inválida.');
    const files = Object.values(req.files || {}).flat();
    const images = [...retained, ...files.map(file => file.filename)];
    if (images.length > 6) throw new Error('Cada produto pode ter até 6 fotos.');
    let ordered = images;
    if (req.body.ordem_imagens !== undefined) {
        const order = JSON.parse(req.body.ordem_imagens);
        if (!Array.isArray(order) || order.length !== images.length) throw new Error('Ordem de fotos inválida.');
        ordered = order.map(key => typeof key === 'number' ? files[key]?.filename : retained.find(name => name === key));
        if (ordered.some(name => !name) || new Set(ordered).size !== images.length) throw new Error('Ordem de fotos inválida.');
    }
    const flag = req.body.venda_externa;
    if (flag !== undefined && ![true, false, 'true', 'false'].includes(flag)) throw new Error('Opção de venda externa inválida.');
    return { imagens: ordered, imagem: ordered[0] || 'avatar.png', venda_externa: flag === undefined ? previous.venda_externa === true : flag === true || flag === 'true' };
};
const publicProducts = (items, req) => req.query.canal === 'ecommerce' ? items.filter(p => p.venda_externa === true) : items;

const readDB = () => {
    try {
        if (!fs.existsSync(DB_PATH)) return [];
        const data = fs.readFileSync(DB_PATH, 'utf-8');
        return JSON.parse(data || '[]');
    } catch (e) { return []; }
};

const writeDB = (data) => {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// 1. LISTAR TODOS
router.get('/', async (req, res) => {
    try {
        const remote = await integration.list('produtos');
        if (!remote) return res.json(publicProducts(readDB(), req));
        const local = readDB();
        res.json(publicProducts(remote.map(item => {
            const merged = { ...item, ...(local.find(saved => String(saved.referencia) === String(item.referencia)) || {}), referencia: item.referencia };
            if (item.preco_alpha !== undefined) {
                merged.preco_alpha = item.preco_alpha;
                merged.variantes = (merged.variantes || []).map(v => ({ ...v, valor_unitario: item.preco_alpha, valor_total: item.preco_alpha * Number(v.quantidade_total || 0) }));
            }
            return merged;
        }), req));
    }
    catch (error) { res.status(502).json({ message: 'Erro ao consultar integração de produtos', error: error.message }); }
});

router.post('/', receivePhotos, async (req, res) => {
    try {
        const produtos = readDB();
        const { referencia } = req.body;

        if (produtos.find(p => String(p.referencia) === String(referencia))) {
            cleanupUploads(req);
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
            ...mediaFields(req),
            variantes: variantesProcessadas
        };

        const remote = awaitRemote('produtos', 'post', null, req.body);
        if (remote) await remote;
        produtos.push(novoProduto);
        writeDB(produtos);
        res.status(201).json(novoProduto);
    } catch (error) {
        cleanupUploads(req);
        console.error("Erro interno no cadastro:", error);
        res.status(400).json({ message: "Erro ao processar dados", error: error.message });
    }
});

// 3. EDITAR
router.put('/:ref', receivePhotos, async (req, res) => {
    try {
    const { ref } = req.params;
    let produtos = readDB();
    let index = produtos.findIndex(p => String(p.referencia) === String(ref));

    if (index === -1) {
        const config = integration.readConfig();
        if (!config.enabled || config.provider === 'local') { cleanupUploads(req); return res.status(404).json({ message: 'Registro nao encontrado' }); }
        const remote = await integration.list('produtos');
        const remoteProduct = remote?.find(item => String(item.referencia) === String(ref));
        if (!remoteProduct) { cleanupUploads(req); return res.status(404).json({ message: 'Produto nao encontrado na integracao.' }); }
        produtos.push({ ...remoteProduct, referencia: ref, data_cadastro: new Date().toISOString() });
        index = produtos.length - 1;
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
        referencia: ref,
        variantes: variantesAtualizadas,
        ...mediaFields(req, produtos[index])
    };

    delete produtoAtualizado.imagens_existentes;
    delete produtoAtualizado.ordem_imagens;

    const previousPhotos = photoNames(produtos[index]);
    produtos[index] = produtoAtualizado;
    writeDB(produtos);
    for (const name of previousPhotos.filter(name => !produtoAtualizado.imagens.includes(name))) {
        const imgPath = path.join(UPLOAD_PATH, path.basename(name));
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    res.json(produtoAtualizado);
    } catch (error) { cleanupUploads(req); res.status(400).json({ message: error.message }); }
});

// 4. EXCLUIR
router.delete('/:ref', (req, res) => {
    const { ref } = req.params;
    let produtos = readDB();
    const produto = produtos.find(p => p.referencia === ref);

    if (!produto) return res.status(404).json({ message: "Produto não encontrado" });

    for (const name of photoNames(produto)) {
        const imgPath = path.join(UPLOAD_PATH, path.basename(name));
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
