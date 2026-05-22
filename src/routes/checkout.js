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
        const headers = { 'access_token': process.env.ASAAS_API_KEY };
        const cpfLimpo = cpf.replace(/\D/g, '');

        // 1. TENTA BUSCAR O CLIENTE
        const search = await axios.get(`${process.env.ASAAS_URL}/customers?cpfCnpj=${cpfLimpo}`, { headers });

        let customerId;
        if (search.data.totalCount > 0) {
            customerId = search.data.data[0].id; // Usa o existente
        } else {
            // 2. CRIA SE NÃO EXISTIR
            const newCustomer = await axios.post(`${process.env.ASAAS_URL}/customers`, {
                name: nome, email: email, cpfCnpj: cpfLimpo
            }, { headers });
            customerId = newCustomer.data.id;
        }

        // 3. GERA O PAGAMENTO
        const payment = await axios.post(`${process.env.ASAAS_URL}/payments`, {
            customer: customerId,
            billingType: "PIX",
            value: valor,
            dueDate: new Date().toISOString().split('T')[0]
        }, { headers });

        // 4. PEGA O QR CODE
        const qrCode = await axios.get(`${process.env.ASAAS_URL}/payments/${payment.data.id}/pixQrCode`, { headers });

        res.json({
            success: true,
            copyPaste: qrCode.data.payload,
            qrCode: qrCode.data.encodedImage
        });

    } catch (error) {
        console.error("Erro detalhado:", error.response?.data || error.message);
        res.status(500).json({ success: false, error: "Falha na comunicação com Asaas" });
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
