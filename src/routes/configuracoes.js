const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const CONFIG_PATH = path.join(__dirname, '../database/configuracoes/ecommerce.json');
const VALID_ORDERS = new Set(['categoria', 'preco', 'mais_novos']);
const DEFAULT_CONFIG = { ordem: 'mais_novos' };

const readConfig = () => {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ordem: VALID_ORDERS.has(config.ordem) ? config.ordem : DEFAULT_CONFIG.ordem };
  } catch {
    return DEFAULT_CONFIG;
  }
};

router.get('/ecommerce', (_req, res) => res.json(readConfig()));

router.put('/ecommerce', (req, res) => {
  const ordem = req.body?.ordem;
  if (!VALID_ORDERS.has(ordem)) {
    return res.status(400).json({ message: 'Ordem inválida.' });
  }

  const config = { ordem };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  return res.json(config);
});

module.exports = { router, readConfig };
