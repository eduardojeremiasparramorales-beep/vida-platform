const express = require('express');
const router = express.Router();
const auth = require('../../services/auth');
const store = require('../../db/store');

router.use(auth.requireAdmin);

// GET / → lista con búsqueda por nombre/teléfono
router.get('/', (req, res) => {
  const { busqueda, limite, offset } = req.query;
  const lim = Number(limite) || 50;
  const off = Number(offset) || 0;

  const data = store.getCustomers({ busqueda, limite: lim, offset: off });

  res.json({ data, meta: { total: data.length, page: Math.floor(off / lim) + 1, limit: lim }, error: null });
});

// GET /:id → detalle + channels + conversations activas
router.get('/:id', (req, res) => {
  const customer = store.getCustomerById(req.params.id);
  if (!customer) return res.status(404).json({ data: null, error: 'customer_no_existe' });

  const channels = store.getCustomerChannels(customer.id);
  const conversations = store.getActiveConversationsByCustomer(customer.id);

  res.json({ data: { customer, channels, conversations }, error: null });
});

// PUT /:id → update name, email, phone, notes, tags
router.put('/:id', (req, res) => {
  const customer = store.getCustomerById(req.params.id);
  if (!customer) return res.status(404).json({ data: null, error: 'customer_no_existe' });

  const updated = store.updateCustomer(req.params.id, req.body || {});
  res.json({ data: updated, error: null });
});

// DELETE /:id → solo si no tiene conversations activas
router.delete('/:id', (req, res) => {
  const customer = store.getCustomerById(req.params.id);
  if (!customer) return res.status(404).json({ data: null, error: 'customer_no_existe' });

  const activas = store.getActiveConversationsByCustomer(customer.id);
  if (activas.length > 0) {
    return res.status(409).json({ data: null, error: 'tiene_conversaciones_activas' });
  }

  store.deleteCustomer(req.params.id);
  res.json({ data: { ok: true }, error: null });
});

module.exports = router;
