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
const statsCache = new Map();

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

function metricKeys(sport, position, names) {
  const nba = [
    'minutes', 'points', 'totalRebounds', 'assists',
    'steals', 'blocks', 'turnovers'
  ];
  const nflByPosition = {
    QB: ['passingYards', 'passingTouchdowns', 'interceptions', 'rushingYards', 'rushingTouchdowns'],
    RB: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns', 'receptions', 'receivingYards', 'receivingTouchdowns'],
    FB: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns', 'receptions', 'receivingYards'],
    WR: ['receptions', 'receivingTargets', 'receivingYards', 'receivingTouchdowns', 'rushingYards'],
    TE: ['receptions', 'receivingTargets', 'receivingYards', 'receivingTouchdowns', 'rushingYards'],
    K: ['fieldGoalsMade-fieldGoalsAttempted', 'extraPointsMade-extraPointAttempts']
  };
  const keys = sport === 'nba'
    ? nba
    : nflByPosition[position] || [
      'totalTackles', 'sacks', 'interceptions', 'fumblesRecovered',
      'defensiveTouchdowns', 'fieldGoalsMade-fieldGoalsAttempted',
      'extraPointsMade-extraPointAttempts'
    ];
  return keys.filter(key => names.includes(key));
}

async function buildPlayerStats(sport, player) {
  const leaguePath = SPORTS[sport];
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/${leaguePath}/athletes/${encodeURIComponent(player.id)}/gamelog?region=us&lang=en-US&contentorigin=espn&isqualified=false`;
  const data = await fetchEspnJson(url);
  const regularSeason = (data.seasonTypes || []).find(season =>
    season.displayName?.includes('Regular Season')
  );
  const events = (regularSeason?.categories || []).flatMap(category => category.events || []);
  const keys = metricKeys(sport, player.position, data.names || []);
  const labels = new Map((data.names || []).map((name, index) => [
    name,
    (data.displayNames || [])[index] || name
  ]));

  const games = events.map(event => {
    const details = data.events?.[event.eventId] || {};
    return {
      date: details.gameDate || '',
      atVs: details.atVs || '',
      opponent: details.opponent?.abbreviation || details.opponent?.shortDisplayName || details.opponent?.displayName || '',
      result: details.gameResult || '',
      score: details.score || '',
      values: keys.map(key => {
        const index = data.names.indexOf(key);
        return { label: labels.get(key), value: event.stats?.[index] ?? '—' };
      })
    };
  }).filter(game => game.values.length);

  const recentGames = games.slice(0, 5);
  const averages = keys.map(key => {
    const index = data.names.indexOf(key);
    const values = events.map(event => event.stats?.[index])
      .filter(value => value !== undefined && value !== null && value !== '' && value !== '-')
      .map(Number)
      .filter(Number.isFinite);
    if (!values.length) return null;
    return {
      label: labels.get(key),
      value: (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)
    };
  }).filter(Boolean);

  return {
    season: regularSeason?.displayName || '',
    gamesPlayed: games.length,
    averages,
    recentGames
  };
}

async function getPlayerStats(sport, player) {
  const cacheKey = `${sport}:${player.id}`;
  const existing = statsCache.get(cacheKey);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;

  const entry = { expiresAt: Date.now() + CACHE_TTL_MS };
  entry.promise = buildPlayerStats(sport, player).catch(error => {
    statsCache.delete(cacheKey);
    throw error;
  });
  statsCache.set(cacheKey, entry);
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

    const [statsA, statsB] = await Promise.allSettled([
      getPlayerStats(sport, a),
      getPlayerStats(sport, b)
    ]);
    const statsResult = (result) => result.status === 'fulfilled'
      ? result.value
      : { error: `Recent stats unavailable: ${result.reason.message}` };

    res.json({
      sport,
      comparison: {
        playerA: { fullName: a.full_name, position: a.position, team: a.team, jersey: a.jersey, status: a.status, stats: statsResult(statsA) },
        playerB: { fullName: b.full_name, position: b.position, team: b.team, jersey: b.jersey, status: b.status, stats: statsResult(statsB) },
        verdict: 'Stats are from ESPN regular-season game logs. Check recent games and current-season averages when setting your lineup.'
      }
    });
  } catch (error) {
    res.status(502).json({ error: `Could not compare ${sport.toUpperCase()} players: ${error.message}` });
  }
});

module.exports = router;
