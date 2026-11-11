/**
 * Phase 5 — AI Start/Sit Assistant.
 * POST /api/assistant/start-sit { sport, question? }
 * Uses the synced roster + live feed context. If MISTRAL_API_KEY is set,
 * asks Mistral for a recommendation; otherwise falls back to a rule-based
 * heuristic so the feature always works.
 */
const express = require('express');
const router = express.Router();

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
  const { sport = 'nfl', question, roster: submittedRoster } = req.body || {};
  if (!['nfl', 'nba'].includes(sport)) {
    return res.status(400).json({ error: "sport must be 'nfl' or 'nba'" });
  }
  if (!Array.isArray(submittedRoster) || submittedRoster.length === 0 || submittedRoster.length > 100) {
    return res.status(400).json({ error: 'Connect a public ESPN league and load your team first.' });
  }
  const roster = submittedRoster
    .filter(player => player && typeof player.fullName === 'string')
    .map(player => ({
      full_name: player.fullName.slice(0, 120),
      position: String(player.position || '—').slice(0, 20),
      team: String(player.team || '—').slice(0, 20),
      slot_type: String(player.slotType || 'BENCH').slice(0, 20),
      is_starter: Boolean(player.isStarter)
    }));
  if (!roster.length) {
    return res.status(400).json({ error: 'The loaded team has no player names to use.' });
  }

  const context = roster.map(p =>
    (p.is_starter ? '[STARTER] ' : '[BENCH] ') + p.full_name + ' — ' + p.position + ' (' + (p.team || '?') + '), slot: ' + p.slot_type
  ).join('\n');

  try {
    if (process.env.MISTRAL_API_KEY) {
      const safeQuestion = typeof question === 'string' ? question.slice(0, 1000) : '';
      const advice = await mistralAdvise(context, safeQuestion || 'Who should I start this week?');
      return res.json({ source: 'mistral', advice });
    }
    return res.json({ source: 'heuristic', advice: heuristicAdvise(roster) });
  } catch (err) {
    return res.json({ source: 'heuristic (fallback)', advice: heuristicAdvise(roster), note: 'AI call failed: ' + err.message });
  }
});

module.exports = router;
