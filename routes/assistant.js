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

function numberOrNull(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? number : null;
}

function canShareSlot(a, b, sport) {
  if (a.position === b.position) return true;
  if (sport === 'nfl') {
    const flexPositions = ['RB', 'FB', 'WR', 'TE'];
    return flexPositions.includes(a.position) && flexPositions.includes(b.position);
  }
  const guardPositions = ['PG', 'SG', 'G'];
  const forwardPositions = ['SF', 'PF', 'F'];
  return (guardPositions.includes(a.position) && guardPositions.includes(b.position)) ||
    (forwardPositions.includes(a.position) && forwardPositions.includes(b.position));
}

function formatPlayer(player) {
  const average = player.projectedPoints === null
    ? 'season average unavailable'
    : player.projectedPoints.toFixed(1) + ' projected fantasy points/game';
  const latest = player.finalPoints === null
    ? 'latest final unavailable'
    : player.finalPoints.toFixed(1) + ' points in the latest completed game';
  return player.full_name + ' (' + player.position + ', ' + player.team + '): ' + average + '; ' + latest + '.';
}

function statsBasedAdvice(roster, sport, question) {
  const starters = roster.filter(player => player.is_starter);
  const bench = roster.filter(player => !player.is_starter && player.slot_type !== 'IR');
  const namedPlayers = roster.filter(player => player.full_name.length > 2 &&
    question.toLowerCase().includes(player.full_name.toLowerCase()));
  const lines = [];

  if (namedPlayers.length >= 2) {
    const [first, second] = namedPlayers.slice(0, 2);
    lines.push(formatPlayer(first));
    lines.push(formatPlayer(second));
    if (first.projectedPoints !== null && second.projectedPoints !== null) {
      const winner = first.projectedPoints >= second.projectedPoints ? first : second;
      const other = winner === first ? second : first;
      const difference = Math.abs(first.projectedPoints - second.projectedPoints);
      lines.push('Based on season fantasy points per game, ' + winner.full_name +
        ' is the higher-projection choice by ' + difference.toFixed(1) + ' points/game. ' +
        'This does not account for opponent matchup, injury news, or your league’s exact weekly projection.');
    } else {
      lines.push('I can’t make a reliable start/sit call between them because one or both season averages are unavailable. The latest final is historical, not a projection.');
    }
    return lines.join('\n');
  }

  const projectedStarters = starters.filter(player => player.projectedPoints !== null)
    .sort((a, b) => b.projectedPoints - a.projectedPoints);
  const projectedBench = bench.filter(player => player.projectedPoints !== null)
    .sort((a, b) => b.projectedPoints - a.projectedPoints);

  if (projectedStarters.length) {
    lines.push('Your highest-projected starters: ' + projectedStarters.slice(0, 3)
      .map(player => player.full_name + ' (' + player.projectedPoints.toFixed(1) + ' pts/game)').join(', ') + '.');
  } else {
    lines.push('Your synced roster does not have season fantasy-point averages available yet, so I can’t rank your starters reliably.');
  }

  const swaps = [];
  for (const starter of starters) {
    if (starter.projectedPoints === null) continue;
    const betterBenchPlayer = projectedBench.find(player =>
      !swaps.some(swap => swap.bench.full_name === player.full_name) &&
      canShareSlot(starter, player, sport) &&
      player.projectedPoints > starter.projectedPoints
    );
    if (betterBenchPlayer) {
      swaps.push({ starter, bench: betterBenchPlayer });
    }
    if (swaps.length >= 2) break;
  }

  if (swaps.length) {
    swaps.forEach(swap => {
      const gap = swap.bench.projectedPoints - swap.starter.projectedPoints;
      lines.push('Consider starting ' + swap.bench.full_name + ' over ' + swap.starter.full_name +
        ' in a compatible roster spot: ' + swap.bench.projectedPoints.toFixed(1) + ' vs. ' +
        swap.starter.projectedPoints.toFixed(1) + ' projected points/game (' + gap.toFixed(1) + ' higher).');
    });
  } else if (projectedBench.length && projectedStarters.length) {
    lines.push('No bench player has a higher season average than a starter at a compatible position.');
  } else if (bench.length) {
    lines.push('Bench-player averages are unavailable, so I can’t recommend a supported swap yet.');
  }

  lines.push('These are season-average estimates, not matchup-specific weekly projections. Latest completed-game points are shown separately as past results.');
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
      is_starter: Boolean(player.isStarter || player.is_starter),
      projectedPoints: numberOrNull(player.projectedPoints),
      finalPoints: numberOrNull(player.finalPoints)
    }));
  if (!roster.length) {
    return res.status(400).json({ error: 'The loaded team has no player names to use.' });
  }

  const context = roster.map(p =>
    (p.is_starter ? '[STARTER] ' : '[BENCH] ') + p.full_name + ' — ' + p.position + ' (' + (p.team || '?') +
    '), slot: ' + p.slot_type + ', season fantasy points/game: ' +
    (p.projectedPoints === null ? 'unavailable' : p.projectedPoints.toFixed(1)) +
    ', latest final fantasy points: ' + (p.finalPoints === null ? 'unavailable' : p.finalPoints.toFixed(1))
  ).join('\n');

  try {
    if (process.env.MISTRAL_API_KEY) {
      const safeQuestion = typeof question === 'string' ? question.slice(0, 1000) : '';
      const advice = await mistralAdvise(context, safeQuestion || 'Who should I start this week?');
      return res.json({ source: 'mistral', advice });
    }
    const safeQuestion = typeof question === 'string' ? question.slice(0, 1000) : '';
    return res.json({
      source: 'stats-based',
      advice: statsBasedAdvice(roster, sport, safeQuestion || 'Who should I start this week?'),
      note: 'A generative AI model is not connected. This recommendation uses your roster and available fantasy-point averages.'
    });
  } catch (err) {
    const safeQuestion = typeof question === 'string' ? question.slice(0, 1000) : '';
    return res.json({
      source: 'stats-based fallback',
      advice: statsBasedAdvice(roster, sport, safeQuestion || 'Who should I start this week?'),
      note: 'The AI service could not respond, so this advice uses your roster and available fantasy-point averages.'
    });
  }
});

module.exports = router;
