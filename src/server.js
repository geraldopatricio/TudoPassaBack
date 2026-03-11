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
app.use('/produtos', produtoRoutes);
app.use('/produtos', checkoutRoutes);

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Backend Rodando!`);
    console.log(`🔗 Produtos: http://localhost:${PORT}/produtos`);
    console.log(`🔗 Checkout PIX: http://localhost:${PORT}/produtos/checkout/pix`);
});