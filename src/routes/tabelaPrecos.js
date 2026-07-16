const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database/tabela_precos/tabela_precos.json');

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
        return [];
    }
};

const writeDB = (data) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// --- ROTAS CRUD ---

router.get('/', (req, res) => res.json(readDB()));


router.post('/', (req, res) => {
    try {
        const tabelas = readDB();

        // Gerar o ID no backend para garantir que não vá vazio
        const novaTabela = {
            ...req.body,
            id: Date.now().toString()
        };

        tabelas.push(novaTabela);
        writeDB(tabelas);

        res.status(201).json(novaTabela);
    } catch (error) {
        res.status(500).json({ message: "Erro ao salvar", error: error.message });
    }
});

router.put('/:id', (req, res) => {
    const { id } = req.params;
    let tabelas = readDB();
    const index = tabelas.findIndex(t => t.id === id);
    if (index === -1) return res.status(404).json({ message: "Não encontrado" });

    tabelas[index] = { ...tabelas[index], ...req.body };
    writeDB(tabelas);
    res.json(tabelas[index]);
});

router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const tabelas = readDB().filter(t => t.id !== id);
    writeDB(tabelas);
    res.json({ message: "Excluído com sucesso" });
});

module.exports = router;