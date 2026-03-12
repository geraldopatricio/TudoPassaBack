require('dotenv').config(); // Carrega as variáveis do .env
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer'); // Importa o nodemailer
const produtoRoutes = require('./routes/produtos');
const checkoutRoutes = require('./routes/checkout');

const app = express();

app.use(cors());
app.use(express.json());

// Servir as imagens estaticamente
app.use('/uploads', express.static(path.join(__dirname, 'database/produtos/uploads')));

// --- CONFIGURAÇÃO DE EMAIL ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_MAIL_SERVER,
    port: 465, // Geralmente 465 para SSL ou 587 para TLS
    secure: true, 
    auth: {
        user: process.env.EMAIL_SERVER,
        pass: process.env.SENHA_EMAIL_SERVER
    }
});

// Rota para envio de e-mail de pedido
app.post('/produtos/notificar-pedido', async (req, res) => {
    const { cliente, itens, total, frete } = req.body;

    const itensHTML = itens.map(item => `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #eee;">
                <b style="color: #333;">${item.descricao}</b><br>
                <small style="color: #6366f1;">TAM: ${item.chosenSize} | QTD: ${item.chosenQty}</small>
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
                R$ ${item.totalPrice.toFixed(2)}
            </td>
        </tr>
    `).join('');

    const htmlBody = `
        <div style="font-family: sans-serif; background-color: #f8fafc; padding: 20px;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; border: 1px solid #e2e8f0;">
                <div style="background: #4f46e5; padding: 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-style: italic;">Tudo Passa Store</h1>
                    <p style="color: #e0e7ff; margin: 5px 0 0; font-size: 12px; font-weight: bold; text-transform: uppercase;">Novo Pedido Recebido</p>
                </div>
                <div style="padding: 30px;">
                    <p>Olá <b>${cliente.nome}</b>, seu pedido foi registrado!</p>
                    <table style="width: 100%; border-collapse: collapse;">
                        ${itensHTML}
                    </table>
                    <div style="margin-top: 20px; padding: 20px; background: #f1f5f9; border-radius: 15px;">
                        <p style="margin: 5px 0;">Frete: R$ ${frete.toFixed(2)}</p>
                        <p style="margin: 5px 0; font-size: 18px; font-weight: bold; color: #4f46e5;">Total: R$ ${total.toFixed(2)}</p>
                    </div>
                    <p style="font-size: 12px; color: #64748b; margin-top: 20px;">Endereço: ${cliente.endereco}</p>
                </div>
                <div style="background: #1e293b; padding: 20px; text-align: center; color: #94a3b8; font-size: 11px;">
                    Tudo Passa Store - ${new Date().getFullYear()}
                </div>
            </div>
        </div>
    `;

    try {
        await transporter.sendMail({
            from: `Tudo Passa Store <${process.env.EMAIL_SERVER}>`,
            to: `gpatricio.melo@gmail.com, ${cliente.email}`,
            subject: `Novo Pedido - ${cliente.nome}`,
            html: htmlBody
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Erro email:", error);
        res.status(500).json({ success: false });
    }
});

// Rotas existentes
app.use('/produtos', produtoRoutes);
app.use('/produtos', checkoutRoutes);

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Backend Rodando!`);
});
