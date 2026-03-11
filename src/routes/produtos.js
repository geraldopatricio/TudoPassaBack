const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const DB_PATH = path.join(__dirname, '../database/produtos/produtos.json');
const UPLOAD_PATH = path.join(__dirname, '../database/produtos/uploads/');

// Configuração do Multer para salvar imagens
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_PATH);
    },
    filename: (req, file, cb) => {
        // Gera um nome único: timestamp-nomeoriginal
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Funções auxiliares para ler e escrever no JSON
const readDB = () => {
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data || '[]');
};

const writeDB = (data) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// --- ROTAS ---

// 1. LISTAR TODOS
router.get('/', (req, res) => {
    const produtos = readDB();
    res.json(produtos);
});

// 2. CONSULTAR POR REFERENCIA
router.get('/:ref', (req, res) => {
    const produtos = readDB();
    const produto = produtos.find(p => p.referencia === req.params.ref);
    if (!produto) return res.status(404).json({ message: "Produto não encontrado" });
    res.json(produto);
});

// 3. CADASTRAR NOVO (com upload de imagem)
router.post('/', upload.single('imagem'), (req, res) => {
    try {
        const produtos = readDB();

        // Os dados de texto vêm em req.body. 
        // Se enviar o JSON de variantes, precisa fazer JSON.parse no body se vier como string.
        const novoProduto = {
            referencia: req.body.referencia,
            categoria: req.body.categoria,
            descricao: req.body.descricao,
            unidade: req.body.unidade,
            imagem: req.file ? req.file.filename : 'avatar.png',
            variantes: typeof req.body.variantes === 'string' ? JSON.parse(req.body.variantes) : req.body.variantes
        };

        produtos.push(novoProduto);
        writeDB(produtos);

        res.status(201).json(novoProduto);
    } catch (error) {
        res.status(400).json({ message: "Erro ao cadastrar", error: error.message });
    }
});

// 4. EDITAR PRODUTO
router.put('/:ref', upload.single('imagem'), (req, res) => {
    const { ref } = req.params;
    let produtos = readDB();
    const index = produtos.findIndex(p => p.referencia === ref);

    if (index === -1) return res.status(404).json({ message: "Produto não encontrado" });

    // Atualiza os campos enviados
    const produtoAtualizado = {
        ...produtos[index],
        ...req.body,
        // Se as variantes vierem como string (comum em FormData), parseamos
        variantes: req.body.variantes ? (typeof req.body.variantes === 'string' ? JSON.parse(req.body.variantes) : req.body.variantes) : produtos[index].variantes
    };

    // Se uma nova imagem foi enviada, deleta a antiga e atualiza o nome
    if (req.file) {
        if (produtos[index].imagem !== 'avatar.png') {
            const oldPath = path.join(UPLOAD_PATH, produtos[index].imagem);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        produtoAtualizado.imagem = req.file.filename;
    }

    produtos[index] = produtoAtualizado;
    writeDB(produtos);
    res.json(produtoAtualizado);
});

// 5. EXCLUIR PRODUTO
router.delete('/:ref', (req, res) => {
    const { ref } = req.params;
    let produtos = readDB();
    const produto = produtos.find(p => p.referencia === ref);

    if (!produto) return res.status(404).json({ message: "Produto não encontrado" });

    // Remove a imagem da pasta (exceto se for o avatar padrão)
    if (produto.imagem !== 'avatar.png') {
        const imgPath = path.join(UPLOAD_PATH, produto.imagem);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    const novosProdutos = produtos.filter(p => p.referencia !== ref);
    writeDB(novosProdutos);

    res.json({ message: "Produto excluído com sucesso" });
});

module.exports = router;