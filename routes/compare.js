/**
 * Quick Compare.
 * Lists every player on current NFL/NBA team rosters from ESPN and compares
 * roster details without requiring a fantasy league sync.
 */
const express = require('express');
const router = express.Router();

const SPORTS = {
  nfl: 'football/nfl',
  nba: 'basketball/nba'
};
const CACHE_TTL_MS = 10 * 60 * 1000;
const TEAM_FETCH_CONCURRENCY = 8;
const playerCache = new Map();

async function fetchEspnJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
  return response.json();
}

function getRosterEntries(roster) {
  return (roster.athletes || []).flatMap(group =>
    Array.isArray(group.items) ? group.items : [group]
  );
}

async function buildPlayerList(sport) {
  const leaguePath = SPORTS[sport];
  const teamData = await fetchEspnJson(
    `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/teams?limit=100`
  );
  const teams = teamData.sports?.[0]?.leagues?.[0]?.teams
    ?.map(entry => entry.team)
    .filter(team => team?.abbreviation && team.isActive !== false);

  if (!teams?.length) throw new Error('ESPN did not return any active teams.');

  const players = [];
  for (let start = 0; start < teams.length; start += TEAM_FETCH_CONCURRENCY) {
    const batch = teams.slice(start, start + TEAM_FETCH_CONCURRENCY);
    const rosters = await Promise.all(batch.map(async team => {
      const roster = await fetchEspnJson(
        `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/teams/${encodeURIComponent(team.abbreviation)}/roster`
      );
      return getRosterEntries(roster).map(player => ({
        id: String(player.id || ''),
        full_name: player.fullName || player.displayName || '',
        position: player.position?.abbreviation || '—',
        team: team.abbreviation,
        jersey: player.jersey || '',
        status: player.status?.type || 'active'
      })).filter(player => player.id && player.full_name);
    }));
    players.push(...rosters.flat());
  }

  const uniquePlayers = [...new Map(players.map(player => [player.id, player])).values()];
  if (!uniquePlayers.length) throw new Error('ESPN returned no rostered players.');
  return uniquePlayers.sort((a, b) => a.full_name.localeCompare(b.full_name));
}

async function getPlayerList(sport) {
  const existing = playerCache.get(sport);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;

  const entry = { expiresAt: Date.now() + CACHE_TTL_MS };
  entry.promise = buildPlayerList(sport).catch(error => {
    playerCache.delete(sport);
    throw error;
  });
  playerCache.set(sport, entry);
  return entry.promise;
}

router.get('/players/:sport', async (req, res) => {
  const sport = (req.params.sport || '').toLowerCase();
  if (!SPORTS[sport]) {
    return res.status(400).json({ error: "sport must be 'nfl' or 'nba'" });
  }

  try {
    const players = await getPlayerList(sport);
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ sport, players, count: players.length });
  } catch (error) {
    res.status(502).json({ error: `Could not load ${sport.toUpperCase()} players: ${error.message}` });
  }
});

router.post('/compare', async (req, res) => {
  const { sport = 'nfl', playerA, playerB } = req.body || {};
  if (!SPORTS[sport]) {
    return res.status(400).json({ error: "sport must be 'nfl' or 'nba'" });
  }
  if (!playerA || !playerB) {
    return res.status(400).json({ error: 'playerA and playerB are required.' });
  }

  try {
    const players = await getPlayerList(sport);
    const a = players.find(player => player.id === String(playerA));
    const b = players.find(player => player.id === String(playerB));
    if (!a || !b) {
      return res.status(404).json({ error: 'One or both players were not found on a current team roster.' });
    }

    res.json({
      sport,
      comparison: {
        playerA: { fullName: a.full_name, position: a.position, team: a.team, jersey: a.jersey, status: a.status },
        playerB: { fullName: b.full_name, position: b.position, team: b.team, jersey: b.jersey, status: b.status },
        verdict: 'Current team-roster details shown. Sync your ESPN league to see fantasy lineup roles.'
      }
    });
  } catch (error) {
    res.status(502).json({ error: `Could not compare ${sport.toUpperCase()} players: ${error.message}` });
  }
});

module.exports = router;
