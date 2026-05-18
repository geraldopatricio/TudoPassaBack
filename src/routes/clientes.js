const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../database/clientes/clientes.json');

// Função auxiliar para ler o JSON
const readDB = () => {
    try {
        if (!fs.existsSync(DB_PATH)) {
            // Se a pasta não existir, cria
            const dir = path.dirname(DB_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(DB_PATH, '[]');
            return [];
        }
        const data = fs.readFileSync(DB_PATH, 'utf-8');
        return JSON.parse(data || '[]');
    } catch (error) {
        console.error("Erro ao ler banco de dados de clientes:", error);
        return [];
    }
};

// Função auxiliar para escrever no JSON
const writeDB = (data) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// --- ROTAS ---

// 1. LISTAR TODOS OS CLIENTES
router.get('/', (req, res) => {
    const clientes = readDB();
    res.json(clientes);
});

// 2. CONSULTAR CLIENTE POR CÓDIGO
router.get('/:codigo', (req, res) => {
    const clientes = readDB();
    const cliente = clientes.find(c => c.codigo === req.params.codigo);
    if (!cliente) return res.status(404).json({ message: "Cliente não encontrado" });
    res.json(cliente);
});

// 3. CADASTRAR NOVO CLIENTE
router.post('/', (req, res) => {
    try {
        const clientes = readDB();
        const { codigo, cpf_cnpj } = req.body;

        // Validação: Evitar código ou CPF duplicado
        if (clientes.find(c => c.codigo === codigo)) {
            return res.status(400).json({ message: "Este código de cliente já está em uso." });
        }
        if (clientes.find(c => c.cpf_cnpj === cpf_cnpj)) {
            return res.status(400).json({ message: "Este CPF/CNPJ já está cadastrado." });
        }

        const novoCliente = {
            codigo: req.body.codigo,
            nome: req.body.nome,
            cpf_cnpj: req.body.cpf_cnpj,
            celular: req.body.celular,
            email: req.body.email,
            endereco: req.body.endereco,
            numero: req.body.numero,
            bairro: req.body.bairro,
            cidade: req.body.cidade,
            uf: req.body.uf,
            cep: req.body.cep,
            data_cadastro: new Date().toISOString()
        };

        clientes.push(novoCliente);
        writeDB(clientes);

        res.status(201).json(novoCliente);
    } catch (error) {
        res.status(400).json({ message: "Erro ao cadastrar cliente", error: error.message });
    }
});

// 4. EDITAR CLIENTE
router.put('/:codigo', (req, res) => {
    const { codigo } = req.params;
    let clientes = readDB();
    const index = clientes.findIndex(c => c.codigo === codigo);

    if (index === -1) return res.status(404).json({ message: "Cliente não encontrado" });

    // Atualiza os dados mantendo o código original e a data de cadastro
    clientes[index] = {
        ...clientes[index],
        ...req.body,
        codigo: clientes[index].codigo, // Impede alteração do código via body
        data_cadastro: clientes[index].data_cadastro
    };

    writeDB(clientes);
    res.json(clientes[index]);
});

// 5. EXCLUIR CLIENTE
router.delete('/:codigo', (req, res) => {
    const { codigo } = req.params;
    let clientes = readDB();
    const clienteExiste = clientes.find(c => c.codigo === codigo);

    if (!clienteExiste) return res.status(404).json({ message: "Cliente não encontrado" });

    const novosClientes = clientes.filter(c => c.codigo !== codigo);
    writeDB(novosClientes);

    res.json({ message: "Cliente excluído com sucesso" });
});

module.exports = router;
