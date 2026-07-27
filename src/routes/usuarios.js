const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Caminhos baseados na sua estrutura
const DB_PATH = path.join(__dirname, '../database/usuarios/usuarios.json');
const UPLOAD_PATH = path.join(__dirname, '../database/usuarios/uploads/');
const AUTH_SECRET = process.env.AUTH_SECRET || 'tudo-passa-local-auth-secret';

const createAccessToken = (usuario) => {
    const payload = Buffer.from(JSON.stringify({ login: usuario.login, tipo: usuario.tipo })).toString('base64url');
    const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
    return `${payload}.${signature}`;
};

// --- CONFIGURAÇÃO DO MULTER (UPLOAD) ---
if (!fs.existsSync(UPLOAD_PATH)) {
    fs.mkdirSync(UPLOAD_PATH, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_PATH);
    },
    filename: (req, file, cb) => {
        // Nome único: timestamp-nome-original
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
        console.error("Erro ao ler banco de dados de usuários:", error);
        return [];
    }
};

const writeDB = (data) => {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// --- ROTAS ---

// 1. LISTAR TODOS
router.get('/', (req, res) => {
    const usuarios = readDB();
    const listaSegura = usuarios.map(({ senha, ...resto }) => resto);
    res.json(listaSegura);
});

// 2. BUSCAR POR LOGIN
router.get('/:login', (req, res) => {
    const usuarios = readDB();
    const user = usuarios.find(u => u.login === req.params.login);
    if (!user) return res.status(404).json({ message: "Usuário não encontrado" });
    const { senha, ...userSemSenha } = user;
    res.json(userSemSenha);
});

// 3. CADASTRAR (Usa upload.single('foto'))
// --- No arquivo src/routes/usuarios.js ---

// No seu POST de cadastro, adicione o campo 'tipo':
router.post('/', upload.single('foto'), (req, res) => {
    try {
        const usuarios = readDB();
        const { login, senha, cpf, email, whatsapp, tipo } = req.body; // <-- Adicionado tipo

        if (usuarios.find(u => u.login === login)) {
            return res.status(400).json({ message: "Este login já está em uso." });
        }

        const novoUsuario = {
            login,
            senha,
            cpf,
            email,
            whatsapp,
            tipo, // <-- Salva o tipo (Cliente, Fornecedor, etc)
            foto: req.file ? req.file.filename : null,
            data_criacao: new Date().toISOString()
        };

        usuarios.push(novoUsuario);
        writeDB(usuarios);

        const { senha: _, ...resposta } = novoUsuario;
        res.status(201).json(resposta);
    } catch (error) {
        res.status(400).json({ message: "Erro ao cadastrar", error: error.message });
    }
});

// 4. EDITAR
router.put('/:login', upload.single('foto'), (req, res) => {
    const { login } = req.params;
    let usuarios = readDB();
    const index = usuarios.findIndex(u => u.login === login);

    if (index === -1) return res.status(404).json({ message: "Usuário não encontrado" });

    // Se enviou nova foto, apaga a anterior
    if (req.file && usuarios[index].foto) {
        const antigaPath = path.join(UPLOAD_PATH, usuarios[index].foto);
        if (fs.existsSync(antigaPath)) fs.unlinkSync(antigaPath);
    }

    usuarios[index] = {
        ...usuarios[index],
        ...req.body,
        foto: req.file ? req.file.filename : usuarios[index].foto,
        login: usuarios[index].login,
        data_criacao: usuarios[index].data_criacao
    };

    writeDB(usuarios);
    const { senha, ...editado } = usuarios[index];
    res.json(editado);
});

// 5. EXCLUIR
router.delete('/:login', (req, res) => {
    const { login } = req.params;
    let usuarios = readDB();
    const usuario = usuarios.find(u => u.login === login);

    if (!usuario) return res.status(404).json({ message: "Usuário não encontrado" });

    if (usuario.foto) {
        const fotoPath = path.join(UPLOAD_PATH, usuario.foto);
        if (fs.existsSync(fotoPath)) fs.unlinkSync(fotoPath);
    }

    const novosUsuarios = usuarios.filter(u => u.login !== login);
    writeDB(novosUsuarios);
    res.json({ message: "Usuário excluído com sucesso" });
});


// Configuração do Transportador de Email (Usando seus dados)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_SERVER, // Certifique-se que está assim
    port: 465,
    secure: true, // true para porta 465
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    tls: {
        rejectUnauthorized: false // Adicione isso se o seu servidor de e-mail tiver certificado self-signed
    }
});

// --- ROTA DE LOGIN ---
router.post('/login', (req, res) => {
    const { login, senha } = req.body;
    const usuarios = readDB();

    const usuario = usuarios.find(u => u.login === login && u.senha === senha);

    if (!usuario) {
        return res.status(401).json({ message: "Usuário ou senha inválidos" });
    }

    const { senha: _, ...dadosPublicos } = usuario;
    res.json({ ...dadosPublicos, accessToken: createAccessToken(usuario) });
});

// --- ROTA ESQUECI A SENHA ---
router.post('/recuperar-senha', async (req, res) => {
    const { email } = req.body;
    const usuarios = readDB();
    const usuario = usuarios.find(u => u.email === email);

    if (!usuario) {
        return res.status(404).json({ message: "E-mail não encontrado." });
    }

    try {
        await transporter.sendMail({
            from: '"Sistema Tudo Passa" <geraldo@gpsoft.net.br>',
            to: email,
            subject: "Recuperação de Senha",
            html: `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                    <h2 style="color: #4f46e5;">Recuperação de Acesso</h2>
                    <p>Olá <b>${usuario.login}</b>,</p>
                    <p>Sua senha de acesso ao sistema é: <strong style="font-size: 18px; color: #ef4444;">${usuario.senha}</strong></p>
                    <p>Recomendamos trocar sua senha após o login.</p>
                </div>
            `
        });
        res.json({ message: "Senha enviada para o seu e-mail!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao enviar e-mail." });
    }
});

router.post('/alterar-senha', (req, res) => {
    const { login, senhaAntiga, novaSenha } = req.body;
    const usuarios = readDB();

    const index = usuarios.findIndex(u => u.login === login);

    if (index === -1) {
        return res.status(404).json({ message: "Usuário não encontrado." });
    }

    if (usuarios[index].senha !== senhaAntiga) {
        return res.status(401).json({ message: "A senha antiga está incorreta." });
    }

    // Atualiza a senha
    usuarios[index].senha = novaSenha;
    writeDB(usuarios);

    res.json({ message: "Senha alterada com sucesso!" });
});

module.exports = router;
