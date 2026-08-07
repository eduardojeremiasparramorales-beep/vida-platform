# Plan de Migración: Schema Legacy → Multicanal

## Problema
Dos sistemas paralelos:
- **Legacy:** `leads` + `messages` (usado por `vendedor.html`, `assigner.js`, rutas `/api/leads/*`)
- **Nuevo:** `customers` + `conversations` + `timeline` (usado por `inbox.html`, `router.js`, rutas `/api/inbox/*`)

## Solución: Unificar en schema NUEVO

### Paso 1: Script de migración de datos (one-time)
```sql
-- Migrar leads → customers + conversations + timeline
INSERT INTO customers (name, phone, created_at)
SELECT customer_name, customer_phone, created_at FROM leads;

INSERT INTO conversations (channel, customer_id, assigned_to_id, status, unread_count, last_message, created_at, updated_at)
SELECT 'whatsapp', c.id, l.assigned_to_id, l.status, l.unread_count, l.last_message, l.created_at, l.updated_at
FROM leads l JOIN customers c ON c.phone = l.customer_phone;

INSERT INTO timeline (conversation_id, event_type, channel, body, direction, from_number, to_number, media_type, media_id, media_mime, media_filename, created_at)
SELECT conv.id, 'message', 'whatsapp', m.body, m.direction, m.from_number, m.to_number, m.media_type, m.media_id, m.media_mime, m.media_filename, m.timestamp
FROM messages m JOIN conversations conv ON 1=1  -- mapping logic
JOIN leads l ON l.id = m.lead_id;
```

### Paso 2: Unificar frontend
- `vendedor.html` → redirigir a `os/inbox.html`
- `os/inbox.html` = el panel único para vendedores y admins

### Paso 3: Eliminar código legacy
- `assigner.js` → delegar a `MessageRouter.routeOutgoing()`
- `src/index.js` rutas `/api/leads/*` → mantener solo compatibilidad
- `store.js` métodos: `saveLead`, `saveMessage`, `getLeads`, etc.

### Rollback
Si algo falla, el schema legacy sigue intacto en la DB. Solo se agregan datos nuevos.
