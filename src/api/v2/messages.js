const express = require('express');
const router = express.Router();
const auth = require('../../services/auth');
const store = require('../../db/store');

router.use(auth.requireAuth);

// GET /?conversationId=X → timeline de esa conversación
router.get('/', (req, res) => {
  const { conversationId } = req.query;
  if (!conversationId) return res.status(400).json({ data: null, error: 'conversationId_requerido' });

  const conversation = store.getConversationById(conversationId);
  if (!conversation) return res.status(404).json({ data: null, error: 'conversation_no_existe' });

  if (req.session.rol !== 'admin' && Number(conversation.assigned_to_id) !== Number(req.session.vendedorId)) {
    return res.status(403).json({ data: null, error: 'sin_permiso' });
  }

  const data = store.getTimelineByConversation(conversationId);
  res.json({ data, error: null });
});

// POST / → enviar mensaje { conversationId, body, media? }
router.post('/', async (req, res) => {
  const { conversationId, body } = req.body || {};
  if (!conversationId || !body) return res.status(400).json({ data: null, error: 'conversationId_y_body_requeridos' });

  const conversation = store.getConversationById(conversationId);
  if (!conversation) return res.status(404).json({ data: null, error: 'conversation_no_existe' });

  if (req.session.rol !== 'admin' && Number(conversation.assigned_to_id) !== Number(req.session.vendedorId)) {
    return res.status(403).json({ data: null, error: 'sin_permiso' });
  }

  try {
    const MessageRouter = require('../../services/router');
    const message = await MessageRouter.routeOutgoing(conversationId, req.session.vendedorId, body);
    res.json({ data: message, error: null });
  } catch (e) {
    console.error('Error enviando mensaje API v2:', e.message);
    res.status(502).json({ data: null, error: 'error_envio', detalle: e.message });
  }
});

module.exports = router;
