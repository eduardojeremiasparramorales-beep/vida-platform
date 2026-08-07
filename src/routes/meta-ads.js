/**
 * Meta Ads — Rutas REST
 * Endpoints para gestionar campañas, audiencias y métricas de Meta Ads.
 */

const express = require('express');
const router = express.Router();
const metaAds = require('../services/meta-ads');
const store = require('../db/store');

// ─── Middleware: verificar configuración ──────────────────────

function requireConfig(req, res, next) {
  if (!metaAds.isConfigured()) {
    return res.status(503).json({
      error: 'meta_ads_no_configurado',
      message: 'Configura META_MARKETING_API_TOKEN y META_AD_ACCOUNT_ID en .env',
    });
  }
  next();
}

// ─── Estado general ──────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const status = await metaAds.getStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Campañas ────────────────────────────────────────────────

router.get('/campaigns', requireConfig, async (req, res) => {
  try {
    const campaigns = await metaAds.getCampaigns();
    res.json(campaigns);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/campaigns/:id', requireConfig, async (req, res) => {
  try {
    const campaign = await metaAds.getCampaignById(req.params.id);
    res.json(campaign);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/campaigns/:id/insights', requireConfig, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const insights = await metaAds.getCampaignInsights(req.params.id, days);
    res.json(insights);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/campaigns/:id/pause', requireConfig, async (req, res) => {
  try {
    const result = await metaAds.pauseCampaign(req.params.id);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/campaigns/:id/resume', requireConfig, async (req, res) => {
  try {
    const result = await metaAds.resumeCampaign(req.params.id);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Ad Sets ─────────────────────────────────────────────────

router.get('/campaigns/:id/adsets', requireConfig, async (req, res) => {
  try {
    const adsets = await metaAds.getAdSets(req.params.id);
    res.json(adsets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/adsets/:id/ads', requireConfig, async (req, res) => {
  try {
    const ads = await metaAds.getAds(req.params.id);
    res.json(ads);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Audiencias personalizadas ───────────────────────────────

router.get('/audiences', requireConfig, async (req, res) => {
  try {
    const audiences = await metaAds.getCustomAudiences();
    res.json(audiences);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/audiences', requireConfig, async (req, res) => {
  try {
    const { name, leads } = req.body;
    if (!name || !leads || !Array.isArray(leads)) {
      return res.status(400).json({ error: 'name y leads (array) requeridos' });
    }
    const audience = await metaAds.createCustomAudience(name, leads);
    res.json(audience);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/audiences/:id/add', requireConfig, async (req, res) => {
  try {
    const { leads } = req.body;
    if (!leads || !Array.isArray(leads)) {
      return res.status(400).json({ error: 'leads (array) requerido' });
    }
    const result = await metaAds.addToAudience(req.params.id, leads);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/audiences/:id/remove', requireConfig, async (req, res) => {
  try {
    const { leads } = req.body;
    if (!leads || !Array.isArray(leads)) {
      return res.status(400).json({ error: 'leads (array) requerido' });
    }
    const result = await metaAds.removeFromAudience(req.params.id, leads);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/audiences/:id/sync-leads', requireConfig, async (req, res) => {
  try {
    const result = await metaAds.syncLeadsToAudience(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/audiences/:id/lookalike', requireConfig, async (req, res) => {
  try {
    const { country, ratio } = req.body;
    const audience = await metaAds.createLookalike(
      req.params.id,
      country || 'CO',
      ratio || 0.01
    );
    res.json(audience);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Pixel ───────────────────────────────────────────────────

router.get('/pixel', requireConfig, async (req, res) => {
  try {
    const info = await metaAds.getPixelInfo();
    res.json(info);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
