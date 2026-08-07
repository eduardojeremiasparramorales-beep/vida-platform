// Bus de eventos en tiempo real (Server-Sent Events).
// Permite que el panel de cada vendedor reciba avisos instantáneos
// cuando llega un mensaje nuevo de un cliente, sin recargar la página.

// Mapa: vendedorId -> Set de respuestas HTTP (conexiones SSE abiertas)
const clients = new Map();

function addClient(vendedorId, res) {
  const id = Number(vendedorId);
  if (!clients.has(id)) clients.set(id, new Set());
  clients.get(id).add(res);

  // Limpiar al cerrar la conexión
  res.on('close', () => removeClient(id, res));
}

function removeClient(vendedorId, res) {
  const id = Number(vendedorId);
  const set = clients.get(id);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(id);
  }
}

// Enviar un evento a TODAS las conexiones abiertas de un vendedor
function emitToVendedor(vendedorId, evento, data) {
  const id = Number(vendedorId);
  const set = clients.get(id);
  if (!set || set.size === 0) return;

  const payload = `event: ${evento}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch (e) {
      removeClient(id, res);
    }
  }
}

// Enviar a todos los administradores conectados (vendedorId = 0 reservado)
function emitToAdmins(evento, data) {
  emitToVendedor(0, evento, data);
}

// Enviar a TODOS los conectados (vendedores + admins) — chat de equipo
function emitToTodos(evento, data) {
  for (const id of clients.keys()) emitToVendedor(id, evento, data);
}

module.exports = { addClient, removeClient, emitToVendedor, emitToAdmins, emitToTodos };
