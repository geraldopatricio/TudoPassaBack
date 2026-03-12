require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const produtoRoutes = require('./routes/produtos');
const checkoutRoutes = require('./routes/checkout');

const app = express();

app.use(cors());
app.use(express.json());

// Servir as imagens
app.use('/uploads', express.static(path.join(__dirname, 'database/produtos/uploads')));

// --- CONFIGURAÇÃO DE EMAIL ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_MAIL_SERVER,
    port: 465,
    secure: true, 
    auth: {
        user: process.env.EMAIL_SERVER,
        pass: process.env.SENHA_EMAIL_SERVER
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
            from: `"Tudo Passa Store" <${process.env.EMAIL_SERVER}>`,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Backend rodando na porta ${PORT}`));
