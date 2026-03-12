const express = require('express');
const router = express.Router();
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

// CONFIGURAÇÃO DO EMAIL (Nodemailer)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_MAIL_SERVER,
    port: 465,
    secure: true, 
    auth: {
        user: process.env.EMAIL_SERVER,
        pass: process.env.SENHA_EMAIL_SERVER
    }
});

// ROTA DO PIX: /produtos/checkout/pix
router.post('/checkout/pix', async (req, res) => {
    try {
        const { nome, email, cpf, valor } = req.body;
        const customerResp = await axios.post(`${process.env.ASAAS_URL}/customers`, {
            name: nome, email: email, cpfCnpj: cpf
        }, { headers: { 'access_token': process.env.ASAAS_API_KEY } });

        const paymentResp = await axios.post(`${process.env.ASAAS_URL}/payments`, {
            customer: customerResp.data.id,
            billingType: "PIX",
            value: valor,
            dueDate: new Date().toISOString().split('T')[0]
        }, { headers: { 'access_token': process.env.ASAAS_API_KEY } });

        const qrCodeResp = await axios.get(`${process.env.ASAAS_URL}/payments/${paymentResp.data.id}/pixQrCode`,
            { headers: { 'access_token': process.env.ASAAS_API_KEY } });

        res.json({
            success: true,
            copyPaste: qrCodeResp.data.payload,
            qrCode: qrCodeResp.data.encodedImage
        });
    } catch (error) {
        console.error("Erro no Checkout:", error.message);
        res.status(500).json({ error: "Erro ao processar pagamento" });
    }
});

// ROTA DO EMAIL: /produtos/notificar-pedido
// Note: O caminho aqui é apenas '/notificar-pedido' pois o prefixo '/produtos' vem do server.js
router.post('/notificar-pedido', async (req, res) => {
    try {
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
                <div style="background: #4f46e5; color: white; padding: 20px; text-align: center;">
                    <h1>Tudo Passa Store</h1>
                    <p>Pedido Confirmado</p>
                </div>
                <div style="padding: 20px;">
                    <p>Olá <b>${cliente.nome}</b>, recebemos seu pedido!</p>
                    <table style="width: 100%; border-collapse: collapse;">${itensHTML}</table>
                    <div style="background: #f1f5f9; padding: 15px; margin-top: 15px; border-radius: 10px;">
                        <p>Frete: R$ ${frete.toFixed(2)}</p>
                        <p><b>Total: R$ ${total.toFixed(2)}</b></p>
                    </div>
                </div>
            </div>
        `;

        await transporter.sendMail({
            from: `"Tudo Passa Store" <${process.env.EMAIL_SERVER}>`,
            to: `gpatricio.melo@gmail.com, ${cliente.email}`,
            subject: `🛍️ Novo Pedido - ${cliente.nome}`,
            html: htmlBody
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Erro ao enviar email:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
