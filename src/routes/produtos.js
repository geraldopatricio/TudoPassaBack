const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

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
router.get('/', (req, res) => {
    res.json(readDB());
});

router.post('/', upload.single('imagem'), (req, res) => {
    try {
        const produtos = readDB();
        const { referencia } = req.body;

        // 1. Verifica se a referência já existe
        if (produtos.find(p => p.referencia === referencia)) {
            return res.status(400).json({ message: "Essa referência já existe no sistema!" });
        }

        // 2. Tratamento seguro das variantes
        let variantesProcessadas = [];
        if (req.body.variantes) {
            variantesProcessadas = typeof req.body.variantes === 'string' 
                ? JSON.parse(req.body.variantes) 
                : req.body.variantes;
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
    let produtos = readDB();
    const index = produtos.findIndex(p => p.referencia === ref);

    if (index === -1) return res.status(404).json({ message: "Produto não encontrado" });

    const produtoAtualizado = {
        ...produtos[index],
        ...req.body,
        variantes: req.body.variantes ? (typeof req.body.variantes === 'string' ? JSON.parse(req.body.variantes) : req.body.variantes) : produtos[index].variantes
    };

    if (req.file) {
        // Se mudou a imagem, o Multer já salvou com o nome referencia.jpeg sobrescrevendo a anterior
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
