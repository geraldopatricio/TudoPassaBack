require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const produtoRoutes = require('./routes/produtos');
const checkoutRoutes = require('./routes/checkout');
const clientesRouter = require('./routes/clientes');
const usuariosRouter = require('./routes/usuarios');
const profissionaisRoutes = require('./routes/profissionais');
const tabelaPrecosRouter = require('./routes/tabelaPrecos');
const pedidosRouter = require('./routes/pedidos');
const financeiroRouter = require('./routes/financeiro');
const logisticaRouter = require('./routes/logistica');

const app = express();

app.use(cors());
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174', 'https://main.di1r7fuo8b0ux.amplifyapp.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(express.json());

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
app.post('/produtos/notificar-pedido', async (req, res) => {
    try {
        const { cliente, itens, total, frete } = req.body;

        const itensHTML = itens.map(item => `
            <tr>
                <td style="padding: 12px; border-bottom: 1px solid #eee;">
                    <b style="color: #333; font-size: 14px;">${item.descricao}</b><br>
                    <small style="color: #6366f1; font-weight: bold;">TAM: ${item.chosenSize} | QTD: ${item.chosenQty}</small>
                </td>
                <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold;">
                    R$ ${item.totalPrice.toFixed(2)}
                </td>
            </tr>
        `).join('');

        const htmlBody = `
            <div style="font-family: sans-serif; background-color: #f8fafc; padding: 20px;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; border: 1px solid #e2e8f0;">
                    <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 30px; text-align: center; color: white;">
                        <h1 style="margin:0; font-style: italic;">Tudo Passa Store</h1>
                        <p style="margin:5px 0 0; font-size: 12px; font-weight: bold; text-transform: uppercase;">Pedido Confirmado</p>
                    </div>
                    <div style="padding: 30px;">
                        <p>Olá <b>${cliente.nome}</b>, recebemos seu pedido!</p>
                        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">${itensHTML}</table>
                        <div style="background: #f1f5f9; padding: 20px; border-radius: 15px;">
                            <p style="margin: 5px 0;">Frete: R$ ${frete.toFixed(2)}</p>
                            <p style="margin: 5px 0; font-size: 18px; font-weight: bold; color: #4f46e5;">Total: R$ ${total.toFixed(2)}</p>
                        </div>
                    </div>
                </div>
            </div>`;

        await transporter.sendMail({
            from: `"Tudo Passa Store" <${process.env.SMTP_USER}>`,
            to: `gpatricio.melo@gmail.com, ${cliente.email}`,
            subject: `🛍️ Novo Pedido - ${cliente.nome}`,
            html: htmlBody
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Erro email:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rotas existentes
app.use('/produtos', produtoRoutes);
app.use('/produtos', checkoutRoutes);
app.use('/clientes', clientesRouter);
app.use('/usuarios', usuariosRouter);
app.use('/profissionais', profissionaisRoutes);
app.use('/tabela-precos', tabelaPrecosRouter);
app.use('/pedidos', pedidosRouter);
app.use('/financeiro', financeiroRouter);
app.use('/logistica', logisticaRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend rodando na porta ${PORT}`));
