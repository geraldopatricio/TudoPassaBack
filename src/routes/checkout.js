const express = require('express');
const router = express.Router();
const axios = require('axios');
const nodemailer = require('nodemailer');

// 1. Configuração do Transporte
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_MAIL_SERVER,
    port: 465,
    secure: true, 
    auth: {
        user: process.env.EMAIL_SERVER,
        pass: process.env.SENHA_EMAIL_SERVER
    }
});

// 2. ROTA PIX -> Acessível em: /produtos/checkout/pix
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
        res.status(500).json({ error: "Erro Pix" });
    }
});

// 3. ROTA EMAIL -> Acessível em: /produtos/notificar-pedido
// ATENÇÃO: Verifique se não há espaços extras no nome da rota
router.post('/notificar-pedido', async (req, res) => {
    console.log("Rota de e-mail acionada!");
    try {
        const { cliente, itens, total, frete } = req.body;

        const itensHTML = itens.map(item => `
            <tr>
                <td style="padding:10px; border-bottom:1px solid #eee;">
                    <b>${item.descricao}</b><br>
                    <small>TAM: ${item.chosenSize} | QTD: ${item.chosenQty}</small>
                </td>
                <td style="padding:10px; border-bottom:1px solid #eee; text-align:right;">
                    R$ ${item.totalPrice.toFixed(2)}
                </td>
            </tr>
        `).join('');

        await transporter.sendMail({
            from: `"Tudo Passa Store" <${process.env.EMAIL_SERVER}>`,
            to: `gpatricio.melo@gmail.com, ${cliente.email}`,
            subject: `🛍️ Pedido Confirmado - ${cliente.nome}`,
            html: `<div style="font-family:sans-serif; padding:20px;">
                    <h2>Olá ${cliente.nome}, pedido recebido!</h2>
                    <table style="width:100%">${itensHTML}</table>
                    <p><b>Total com Frete: R$ ${total.toFixed(2)}</b></p>
                  </div>`
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Erro e-mail:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
