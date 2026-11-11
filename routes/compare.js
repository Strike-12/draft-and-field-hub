/**
 * Phase 4 — Quick Compare.
 * GET  /api/players/:sport        — list synced players for dropdowns
 * POST /api/compare               — side-by-side stat comparison
 */
const express = require('express');
const router = express.Router();
const db = require('../db');

let lastSyncUser = null;

router.use((req, res, next) => {
  // The espn sync route stores the active user id here.
  if (req.app.get('activeUserId')) lastSyncUser = req.app.get('activeUserId');
  next();
});

router.get('/players/:sport', async (req, res) => {
  const sport = (req.params.sport || '').toLowerCase();
  if (!['nfl', 'nba'].includes(sport)) return res.status(400).json({ error: "sport must be 'nfl' or 'nba'" });
  const userId = lastSyncUser;
  if (!userId) return res.json({ players: [], note: 'No league synced yet.' });
  const roster = await db.getRoster(userId, sport);
  res.json({ players: roster });
});

router.post('/compare', async (req, res) => {
  const { sport = 'nfl', playerA, playerB } = req.body || {};
  if (!playerA || !playerB) return res.status(400).json({ error: 'playerA and playerB are required.' });
  const userId = lastSyncUser;
  if (!userId) return res.status(400).json({ error: 'Sync a league first (Phase 2).' });

  const roster = await db.getRoster(userId, sport);
  const pick = (name) => roster.find(p => p.full_name && p.full_name.toLowerCase().includes(String(name).toLowerCase()));
  const a = pick(playerA);
  const b = pick(playerB);
  if (!a || !b) return res.status(404).json({ error: 'One or both players not found in your synced roster.' });

  res.json({
    sport,
    comparison: {
      playerA: { fullName: a.full_name, position: a.position, team: a.team, slot: a.slot_type, starter: a.is_starter },
      playerB: { fullName: b.full_name, position: b.position, team: b.team, slot: b.slot_type, starter: b.is_starter },
      verdict: a.slot_type === b.slot_type
        ? (a.is_starter && !b.is_starter ? a.full_name + ' is currently starting over ' + b.full_name + '.'
          : b.is_starter && !a.is_starter ? b.full_name + ' is currently starting over ' + a.full_name + '.'
          : 'Both are in the same role; check the live feed for recent form.')
        : 'Different positions — compare via FLEX utility.'
    }
  });
});

module.exports = router;
