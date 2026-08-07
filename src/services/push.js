// Notificaciones push al celular del vendedor aunque el panel esté cerrado.
// Dos canales según cómo esté instalado el panel:
// - Web Push (VAPID): PWA en navegador / instalada desde Chrome.
// - FCM (Firebase Cloud Admin): app nativa empaquetada con Capacitor (más confiable
//   en Android que Web Push, que Android puede matar en segundo plano).
const webpush = require('web-push');
const store = require('../db/store');

let enabled = false;
let fcmEnabled = false;

function init() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@spinmobiliaria.com';
  if (!pub || !priv) {
    console.warn('Web Push deshabilitado: faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY');
  } else {
    webpush.setVapidDetails(subject, pub, priv);
    enabled = true;
  }

  // FCM: opcional. Requiere un service account de Firebase (Project Settings →
  // Service Accounts → Generate new private key), pegado en la variable de entorno
  // FCM_SERVICE_ACCOUNT_JSON. Sin esto, la app nativa simplemente no recibe push
  // (el resto del CRM sigue funcionando igual).
  // Acepta dos formatos: el JSON crudo (empieza con '{') o el JSON codificado en
  // base64 (recomendado — evita que los saltos de línea de la private_key se
  // rompan al pegarlo en un .env de una sola línea).
  const saRaw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (saRaw) {
    try {
      const saJson = saRaw.trim().startsWith('{') ? saRaw : Buffer.from(saRaw, 'base64').toString('utf8');
      const admin = require('firebase-admin');
      const serviceAccount = JSON.parse(saJson);
      if (!admin.getApps().length) admin.initializeApp({ credential: admin.cert(serviceAccount) });
      fcmEnabled = true;
    } catch (e) {
      console.error('FCM deshabilitado: FCM_SERVICE_ACCOUNT_JSON inválido (¿JSON crudo o base64 corrupto?) —', e.message);
    }
  }
}

function isEnabled() { return enabled; }
function isFcmEnabled() { return fcmEnabled; }

function getPublicKey() { return process.env.VAPID_PUBLIC_KEY || ''; }

// Envía una notificación a todas las suscripciones de un vendedor, sin importar el
// canal (Web Push y/o FCM) — un vendedor puede tener ambas si usa el panel web y la app.
async function sendToVendedor(vendedorId, payload) {
  if (vendedorId == null) return; // 0 es válido: canal de admins
  const subs = store.getPushSubscriptionsByVendedor(vendedorId);
  if (!subs.length) {
    console.warn(`[PUSH] vendor ${vendedorId} no tiene suscripciones push (FCM/WebPush) registradas`);
    return;
  }
  for (const s of subs) {
    if (s.tipo === 'fcm') {
      await sendFcm(s, payload);
    } else {
      await sendWebPush(s, payload);
    }
  }
}

async function sendWebPush(s, payload) {
  if (!enabled) return;
  const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) store.deletePushSubscription(s.endpoint);
    else console.error('Error Web Push:', e.statusCode || e.message);
  }
}

async function sendFcm(s, payload) {
  if (!fcmEnabled) return;
  if (!s.endpoint || s.endpoint.length < 20) {
    console.warn(`[FCM] Token inválido/corto, eliminando: ${s.endpoint || '(vacío)'}`);
    store.deletePushSubscription(s.endpoint);
    return;
  }
  const tokenPreview = String(s.endpoint || '').slice(0, 20) + '...';
  try {
    const admin = require('firebase-admin');
    // Excluir title/body del data payload (ya están en notification) para evitar
    // messaging/invalid-argument por duplicación de campos.
    const dataFields = Object.fromEntries(
      Object.entries(payload)
        .filter(([k]) => k !== 'title' && k !== 'body')
        .map(([k, v]) => [k, String(v)])
    );
    await require('firebase-admin/messaging').getMessaging().send({
      token: s.endpoint,
      notification: { title: payload.title || 'Leons Group', body: payload.body || '' },
      data: dataFields,
      android: { priority: 'high', notification: { channelId: 'leons_group_push', sound: 'default', defaultSound: true, visibility: 'public' } },
    });
    console.log(`[FCM] OK → ${tokenPreview}`);
  } catch (e) {
    const code = e.code || e.message;
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      console.warn(`[FCM] Token inválido (${code}), eliminando suscripción: ${tokenPreview}`);
      store.deletePushSubscription(s.endpoint);
    } else if (code === 'messaging/invalid-argument') {
      // invalid-argument generalmente es payload issue, NO token issue. No eliminar.
      console.error(`[FCM] Payload inválido (${code}) para ${tokenPreview} — verificar title/body/data`);
    } else {
      console.error(`[FCM] Error ${code} para ${tokenPreview}`);
    }
  }
}

module.exports = { init, isEnabled, isFcmEnabled, getPublicKey, sendToVendedor };
