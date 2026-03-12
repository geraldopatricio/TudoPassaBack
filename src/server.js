require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const produtoRoutes = require('./routes/produtos');
const checkoutRoutes = require('./routes/checkout');

const app = express();

app.use(cors());
app.use(express.json());

// Servir as imagens estaticamente
app.use('/uploads', express.static(path.join(__dirname, 'database/produtos/uploads')));

// Rotas unificadas sob o prefixo /produtos
// Importante: O checkoutRoutes agora contém a rota de e-mail
app.use('/produtos', produtoRoutes);
app.use('/produtos', checkoutRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Backend Rodando!`);
    console.log(`🔗 Base URL: http://localhost:${PORT}/produtos`);
});
