require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const swaggerUi = require('swagger-ui-express');
const openapi = require('./docs/openapi');
const produtoRoutes = require('./routes/produtos');
const checkoutRoutes = require('./routes/checkout');
const clientesRouter = require('./routes/clientes');
const usuariosRouter = require('./routes/usuarios');
const profissionaisRoutes = require('./routes/profissionais');
const tabelaPrecosRouter = require('./routes/tabelaPrecos');
const pedidosRouter = require('./routes/pedidos');
const financeiroRouter = require('./routes/financeiro');
const logisticaRouter = require('./routes/logistica');
const integracoesRouter = require('./routes/integracoes');

const app = express();

app.use(cors());
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174', 'https://tudopassa.lookrapido.com.br'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(express.json());

// Documentação oficial: JSON OpenAPI e Swagger UI tradicional.
app.get('/openapi.json', (_req, res) => res.json(openapi));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi, {
    customSiteTitle: 'Tudo Passa API',
    swaggerOptions: { docExpansion: 'none', filter: true, displayRequestDuration: true }
}));

// Servir as imagens//
app.use('/uploads/produtos', express.static(path.join(__dirname, 'database/produtos/uploads')));
app.use('/uploads/usuarios', express.static(path.join(__dirname, 'database/usuarios/uploads')));
app.use('/uploads/profissionais', express.static(path.join(__dirname, 'database/profissionais/uploads')));
app.use('/uploads/clientes', express.static(path.join(__dirname, 'database/clientes/uploads')));
app.use('/uploads/logistica', express.static(path.join(__dirname, 'database/logistica/uploads')));

// --- CONFIGURAÇÃO DE EMAIL ---
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

// --- ROTA DE NOTIFICAÇÃO (DIRETO NO SERVER.JS PARA EVITAR 404) ---
app.use('/produtos', produtoRoutes);
app.use('/produtos', checkoutRoutes);
app.use('/clientes', clientesRouter);
app.use('/usuarios', usuariosRouter);
app.use('/profissionais', profissionaisRoutes);
app.use('/tabela-precos', tabelaPrecosRouter);
app.use('/pedidos', pedidosRouter);
app.use('/relatorios', require('./routes/relatorios'));
app.use('/financeiro', financeiroRouter);
app.use('/logistica', logisticaRouter);
app.use('/integracoes', integracoesRouter);
app.use('/dashboard', require('./routes/dashboard'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Backend rodando em http://0.0.0.0:${PORT}`);
    console.log(`Pode ser acessado pelo IP do servidor na porta ${PORT}`);
});
