const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const FIN_PATH = path.join(__dirname, '../database/financeiro/financeiro.json');

const readFIN = () => {
    try {
        if (!fs.existsSync(FIN_PATH)) return [];
        return JSON.parse(fs.readFileSync(FIN_PATH, 'utf-8') || '[]');
    } catch (e) { return []; }
};

const writeFIN = (data) => {
    if (!fs.existsSync(path.dirname(FIN_PATH))) fs.mkdirSync(path.dirname(FIN_PATH), { recursive: true });
    fs.writeFileSync(FIN_PATH, JSON.stringify(data, null, 2));
};

// Listar todos os lançamentos
router.get('/', (req, res) => {
    res.json(readFIN());
});

// Criar lançamento manual (Opcional)
router.post('/', (req, res) => {
    const lancamentos = readFIN();
    const novo = { id: `FIN${Date.now()}`, ...req.body };
    lancamentos.push(novo);
    writeFIN(lancamentos);
    res.status(201).json(novo);
});

// Atualizar situação (Ex: de 'Em aberto' para 'Recebido')
router.put('/:id', (req, res) => {
    let lancamentos = readFIN();
    const index = lancamentos.findIndex(f => f.id === req.params.id);
    if (index === -1) return res.status(404).json({ message: "Lançamento não encontrado" });

    lancamentos[index] = { ...lancamentos[index], ...req.body };
    writeFIN(lancamentos);
    res.json(lancamentos[index]);
});

// Excluir lançamento
router.delete('/:id', (req, res) => {
    let lancamentos = readFIN();
    lancamentos = lancamentos.filter(f => f.id !== req.params.id);
    writeFIN(lancamentos);
    res.json({ message: "Lançamento removido" });
});

module.exports = router;