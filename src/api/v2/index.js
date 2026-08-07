const express = require('express');
const router = express.Router();

const conversationsRouter = require('./conversations');
const customersRouter = require('./customers');
const messagesRouter = require('./messages');

router.get('/', (req, res) => {
  res.json({
    data: {
      version: '2.0',
      endpoints: [
        'GET /api/v2/conversations',
        'GET /api/v2/conversations/:id',
        'PUT /api/v2/conversations/:id',
        'POST /api/v2/conversations/:id/assign',
        'POST /api/v2/conversations/:id/close',
        'DELETE /api/v2/conversations/:id',
        'GET /api/v2/customers',
        'GET /api/v2/customers/:id',
        'PUT /api/v2/customers/:id',
        'DELETE /api/v2/customers/:id',
        'GET /api/v2/messages?conversationId=X',
        'POST /api/v2/messages',
      ],
    },
    error: null,
  });
});

router.use('/conversations', conversationsRouter);
router.use('/customers', customersRouter);
router.use('/messages', messagesRouter);

module.exports = router;
