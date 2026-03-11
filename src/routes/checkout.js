const express = require('express');
const router = express.Router();
const axios = require('axios');
require('dotenv').config();

router.post('/checkout/pix', async (req, res) => {
    try {
        const { nome, email, cpf, valor } = req.body;

        // Verifica se as variáveis de ambiente existem
        if (!process.env.ASAAS_API_KEY) {
            return res.status(500).json({ error: "Token do Asaas não configurado no .env" });
        }

        // 1. Criar Cliente
        const customerResp = await axios.post(`${process.env.ASAAS_URL}/customers`, {
            name: nome,
            email: email,
            cpfCnpj: cpf
        }, { headers: { 'access_token': process.env.ASAAS_API_KEY } });

        // 2. Criar Cobrança
        const paymentResp = await axios.post(`${process.env.ASAAS_URL}/payments`, {
            customer: customerResp.data.id,
            billingType: "PIX",
            value: valor,
            dueDate: new Date().toISOString().split('T')[0]
        }, { headers: { 'access_token': process.env.ASAAS_API_KEY } });

        // 3. Gerar QR Code
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
        res.status(500).json({
            error: "Erro ao processar pagamento",
            details: error.response?.data?.errors?.[0]?.description || error.message
        });
    }
});

module.exports = router;