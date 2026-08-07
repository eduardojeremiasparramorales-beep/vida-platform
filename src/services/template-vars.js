// Catálogo único de variables disponibles para plantillas de WhatsApp — reutilizado
// tanto por el envío 1-a-1 (iniciar conversación) como por el motor de campañas masivas,
// para que ambos flujos resuelvan las mismas variables de la misma forma.

const CATALOG = [
  { key: 'nombre_cliente', label: 'Nombre del cliente' },
  { key: 'telefono', label: 'Teléfono del cliente' },
  { key: 'proyecto', label: 'Proyecto / lote de interés' },
  { key: 'ciudad', label: 'Ciudad' },
  { key: 'precio', label: 'Precio / presupuesto' },
  { key: 'vendedor_nombre', label: 'Nombre del vendedor' },
  { key: 'vendedor_telefono', label: 'Teléfono del vendedor' },
  { key: 'link_ubicacion', label: 'Link de ubicación del lote' },
  { key: 'link_catalogo', label: 'Link al catálogo de propiedades' },
  { key: 'empresa', label: 'Nombre de la empresa' },
];

// Resuelve los valores reales de cada variable del catálogo a partir de un lead
// (y opcionalmente su vendedor asignado). Campos que el lead no tiene aún quedan
// en '' — el remitente los completa a mano antes de enviar (ver Fase 1.4).
function resolveLeadVariables(lead, vendedor) {
  const store = require('../db/store');
  return {
    nombre_cliente: (lead && lead.customer_name) || 'Cliente',
    telefono: (lead && lead.customer_phone) || '',
    proyecto: (lead && lead.proyecto) || '',
    ciudad: (lead && lead.ciudad) || '',
    precio: (lead && lead.presupuesto) || '',
    vendedor_nombre: (vendedor && vendedor.nombre) || '',
    vendedor_telefono: (vendedor && vendedor.telefono) || '',
    link_ubicacion: (lead && lead.link_ubicacion) || '',
    // Antes apuntaba a /os/propiedades.html — panel admin protegido por sesión: un cliente
    // que recibiera este link por WhatsApp caía en el login. El catálogo público real
    // (sin sesión, OG tags para preview en WhatsApp) vive en /catalogo/.
    link_catalogo: `${process.env.BASE_URL || ''}/catalogo/`,
    empresa: store.getConfig('company_name') || 'Leons Group',
  };
}

module.exports = { CATALOG, resolveLeadVariables };
