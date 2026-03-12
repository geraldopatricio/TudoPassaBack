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

app.use('/uploads', express.static(path.join(__dirname, 'database/produtos/uploads')));

// --- TRANSPORTE DE EMAIL ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_MAIL_SERVER,
    port: 465,
    secure: true, 
    auth: {
        user: process.env.EMAIL_SERVER,
        pass: process.env.SENHA_EMAIL_SERVER
    }
});

// --- ROTA DE EMAIL (REGISTRADA DIRETAMENTE NO APP) ---
// Note que agora ela está fora dos arquivos de rota para não ter erro de 404
app.post('/produtos/notificar-pedido', async (req, res) => {
    console.log("Recebida tentativa de envio de e-mail para:", req.body.cliente?.email);
    
    const { cliente, itens, total, frete } = req.body;

    const itensHTML = itens.map(item => `
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">
                <b>${item.descricao}</b><br>
                <small>TAM: ${item.chosenSize} | QTD: ${item.chosenQty}</small>
            </td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">
                R$ ${item.totalPrice.toFixed(2)}
            </td>
        </tr>
    `).join('');

    const htmlBody = `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 20px; overflow: hidden;">
            <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: white; padding: 30px; text-align: center;">
                <h1 style="margin:0; font-style: italic;">Tudo Passa Store</h1>
                <p style="margin:5px 0 0; opacity: 0.8; font-weight: bold; text-transform: uppercase; font-size: 12px;">Confirmação de Pedido</p>
            </div>
            <div style="padding: 30px;">
                <p>Olá <b>${cliente.nome}</b>, recebemos seu pedido!</p>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                    ${itensHTML}
                </table>
                <div style="background: #f1f5f9; padding: 20px; border-radius: 15px;">
                    <p style="margin: 5px 0;">Frete: R$ ${frete.toFixed(2)}</p>
                    <p style="margin: 5px 0; font-size: 18px; font-weight: bold; color: #4f46e5;">Total: R$ ${total.toFixed(2)}</p>
                </div>
                <p style="font-size: 12px; color: #64748b; margin-top: 25px;">Endereço de entrega: ${cliente.endereco}</p>
            </div>
            <div style="background: #1e293b; color: #94a3b8; padding: 20px; text-align: center; font-size: 11px;">
                © ${new Date().getFullYear()} Tudo Passa Store
            </div>
        </div>
    `;

    try {
        await transporter.sendMail({
            from: `"Tudo Passa Store" <${process.env.EMAIL_SERVER}>`,
            to: `gpatricio.melo@gmail.com, ${cliente.email}`,
            subject: `🛍️ Pedido Realizado - ${cliente.nome}`,
            html: htmlBody
        });
        console.log("E-mail enviado com sucesso!");
        res.json({ success: true });
    } catch (error) {
        console.error("Erro no envio do e-mail:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rotas de produtos e checkout normais
app.use('/produtos', produtoRoutes);
app.use('/produtos', checkoutRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend Rodando na porta ${PORT}`);
});
