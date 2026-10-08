const express = require('express');
const router = express.Router();
const asaas = require('../services/asaasService');
const nodemailer = require('nodemailer');
const { orderEmail } = require('../services/orderEmail');

// 1. Configuração do Transporte
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

// 2. ROTA PIX -> Acessível em: /produtos/checkout/pix
router.post('/checkout/pix', async (req, res) => {
    try {
        const { nome, email, cpf, valor } = req.body;
        const api = asaas.client();
        const headers = {};
        if (!nome || ![11, 14].includes(String(cpf || '').replace(/\D/g, '').length) || !Number.isFinite(Number(valor)) || Number(valor) <= 0) return res.status(400).json({ success: false, error: 'Informe nome, CPF/CNPJ e valor válidos.' });
        const cpfLimpo = String(cpf).replace(/\D/g, '');

        // 1. TENTA BUSCAR O CLIENTE
        const search = await api.get(`/customers?cpfCnpj=${cpfLimpo}`, { headers });

        let customerId;
        if (search.data.totalCount > 0) {
            customerId = search.data.data[0].id; // Usa o existente
        } else {
            // 2. CRIA SE NÃO EXISTIR
            const newCustomer = await api.post(`/customers`, {
                name: nome, email: email, cpfCnpj: cpfLimpo
            }, { headers });
            customerId = newCustomer.data.id;
        }

        // 3. GERA O PAGAMENTO
        const payment = await api.post(`/payments`, {
            customer: customerId,
            billingType: "PIX",
            value: valor,
            dueDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
        }, { headers });

        // 4. PEGA O QR CODE
        const qrCode = await api.get(`/payments/${payment.data.id}/pixQrCode`, { headers });

        if (!qrCode.data.payload) throw new Error('O Asaas não retornou o código Pix copia e cola.');
        res.json({
            success: true,
            paymentId: payment.data.id,
            invoiceUrl: payment.data.invoiceUrl,
            expirationDate: qrCode.data.expirationDate,
            copyPaste: qrCode.data.payload,
            qrCode: asaas.qrImage(qrCode.data.encodedImage)
        });

    } catch (error) {
        console.error("Falha na geração Pix:", error.response?.status || error.message);
        res.status(502).json({ success: false, error: error.response?.data?.errors?.map(e => e.description).join('; ') || error.message });
    }
});

// 3. ROTA EMAIL -> Acessível em: /produtos/notificar-pedido
// ATENÇÃO: Verifique se não há espaços extras no nome da rota
router.post('/notificar-pedido', async (req, res) => {
    console.log("Rota de e-mail acionada!");
    try {
        const { cliente } = req.body;
        await transporter.sendMail({
            from: `"Tudo Passa Store" <${process.env.SMTP_USER}>`,
            to: [process.env.ORDER_EMAIL_COPY || 'gpatricio.melo@gmail.com', cliente.email],
            subject: `Pedido recebido - aguardando Pix - ${cliente.nome}`,
            ...orderEmail(req.body)
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Erro e-mail:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
