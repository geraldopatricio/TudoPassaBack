const express = require('express');
const router = express.Router();
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

// --- CONFIGURAÇÃO DO TRANSPORTE DE EMAIL ---
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_MAIL_SERVER,
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_SERVER,
        pass: process.env.SENHA_EMAIL_SERVER
    }
});

// ROTA 1: Checkout PIX (Já existente)
router.post('/checkout/pix', async (req, res) => {
    try {
        const { nome, email, cpf, valor } = req.body;

        if (!process.env.ASAAS_API_KEY) {
            return res.status(500).json({ error: "Token do Asaas não configurado" });
        }

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
            paymentId: paymentResp.data.id,
            copyPaste: qrCodeResp.data.payload,
            qrCode: qrCodeResp.data.encodedImage
        });
    } catch (error) {
        console.error("Erro no Checkout:", error.response?.data || error.message);
        res.status(500).json({ error: "Erro ao processar pagamento" });
    }
});

// ROTA 2: Notificar Pedido por E-mail
// No frontend, chame: SEU_URL/produtos/notificar-pedido
router.post('/notificar-pedido', async (req, res) => {
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
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 15px rgba(0,0,0,0.05);">
                <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-style: italic;">Tudo Passa Store</h1>
                    <p style="color: #e0e7ff; margin: 5px 0 0; font-size: 11px; font-weight: bold; text-transform: uppercase;">Novo Pedido Recebido</p>
                </div>
                <div style="padding: 30px;">
                    <p style="color: #1e293b; font-size: 16px;">Olá <b>${cliente.nome}</b>, recebemos seu pedido!</p>
                    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                        ${itensHTML}
                    </table>
                    <div style="margin-top: 20px; padding: 20px; background: #f1f5f9; border-radius: 15px;">
                        <p style="margin: 5px 0; color: #64748b;">Frete: R$ ${frete.toFixed(2)}</p>
                        <p style="margin: 5px 0; font-size: 18px; font-weight: bold; color: #4f46e5;">Total: R$ ${total.toFixed(2)}</p>
                    </div>
                    <p style="font-size: 12px; color: #64748b; margin-top: 20px; border-left: 3px solid #4f46e5; padding-left: 10px;">
                        <b>Endereço de Entrega:</b><br>${cliente.endereco}
                    </p>
                </div>
                <div style="background: #1e293b; padding: 20px; text-align: center; color: #94a3b8; font-size: 11px;">
                    Tudo Passa Store - ${new Date().getFullYear()}
                </div>
            </div>
        </div>
    `;

    try {
        await transporter.sendMail({
            from: `"Tudo Passa Store" <${process.env.EMAIL_SERVER}>`,
            to: `gpatricio.melo@gmail.com, ${cliente.email}`,
            subject: `🛍️ Pedido Confirmado - ${cliente.nome}`,
            html: htmlBody
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Erro ao enviar e-mail:", error);
        res.status(500).json({ success: false, error: "Falha ao enviar e-mail" });
    }
});

module.exports = router;
