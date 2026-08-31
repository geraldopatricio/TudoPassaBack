const express = require('express');
const integration = require('../services/integrationService');
const router = express.Router();

router.get('/', (_req, res) => res.json(integration.publicConfig()));
router.put('/', (req, res) => {
  try { res.json(integration.publicConfig(integration.mergeConfig(req.body || {}))); }
  catch (error) { res.status(400).json({ message: 'Configuração inválida', error: error.message }); }
});
router.post('/testar', async (req, res) => {
  try {
    integration.mergeConfig(req.body || {});
    const results = await Promise.all(['clientes', 'produtos', 'profissionais'].map(async resource => {
      try { const items = await integration.list(resource); return [resource, { total: items?.length || 0, success: true }]; }
      catch (error) { return [resource, { total: 0, success: false, error: error.message }]; }
    }));
    const totals = Object.fromEntries(results);
    const success = Object.values(totals).some(item => item.success);
    res.json({ success, totals });
  } catch (error) { res.status(502).json({ success: false, message: error.message }); }
});

module.exports = router;
