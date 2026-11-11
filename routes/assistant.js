/**
 * Phase 5 — AI Start/Sit Assistant.
 * POST /api/assistant/start-sit { sport, question? }
 * Uses the synced roster + live feed context. If MISTRAL_API_KEY is set,
 * asks Mistral for a recommendation; otherwise falls back to a rule-based
 * heuristic so the feature always works.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');

async function mistralAdvise(context, question) {
  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + process.env.MISTRAL_API_KEY
    },
    body: JSON.stringify({
      model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
      messages: [
        { role: 'system', content: 'You are a fantasy sports start/sit advisor. Be concise and concrete. Recommend starters and 1-2 bench swaps max.' },
        { role: 'user', content: 'Roster context:\n' + context + '\n\nQuestion: ' + question }
      ]
    })
  });
  if (!res.ok) throw new Error('Mistral API returned ' + res.status);
  const data = await res.json();
  return data.choices[0].message.content;
}

function heuristicAdvise(roster) {
  const starters = roster.filter(p => p.is_starter);
  const bench = roster.filter(p => !p.is_starter);
  const lines = [];
  lines.push('Start your locked-in starters: ' + starters.slice(0, 3).map(p => p.full_name).join(', ') + '.');
  if (bench.length) {
    lines.push('Bench option to watch: ' + bench[0].full_name + ' (' + bench[0].position + ') — promote them if a starter is questionable or on bye.');
  }
  lines.push('General rule: favor players with a healthy matchup volume (targets/carries in NFL, minutes in NBA).');
  return lines.join('\n');
}

router.post('/assistant/start-sit', async (req, res) => {
  const { sport = 'nfl', question } = req.body || {};
  const userId = req.app.get('activeUserId');
  if (!userId) return res.status(400).json({ error: 'Sync a league first (Phase 2).' });

  const roster = await db.getRoster(userId, sport);
  if (!roster.length) return res.status(404).json({ error: 'No synced roster for ' + sport + '.' });

  const context = roster.map(p =>
    (p.is_starter ? '[STARTER] ' : '[BENCH] ') + p.full_name + ' — ' + p.position + ' (' + (p.team || '?') + '), slot: ' + p.slot_type
  ).join('\n');

  try {
    if (process.env.MISTRAL_API_KEY) {
      const advice = await mistralAdvise(context, question || 'Who should I start this week?');
      return res.json({ source: 'mistral', advice });
    }
    return res.json({ source: 'heuristic', advice: heuristicAdvise(roster) });
  } catch (err) {
    return res.json({ source: 'heuristic (fallback)', advice: heuristicAdvise(roster), note: 'AI call failed: ' + err.message });
  }
});

module.exports = router;
