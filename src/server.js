require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const produtoRoutes = require('./routes/produtos');
const checkoutRoutes = require('./routes/checkout');

const app = express();

app.use(cors());
app.use(express.json());

// Servir as imagens
app.use('/uploads', express.static(path.join(__dirname, 'database/produtos/uploads')));

// Registrar as rotas
// Ao usar '/produtos', o checkoutRoutes ganha esse prefixo automaticamente
app.use('/produtos', produtoRoutes);
app.use('/produtos', checkoutRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
