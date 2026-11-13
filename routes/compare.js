/**
 * Quick Compare.
 * Lists every player on current NFL/NBA team rosters from ESPN and compares
 * roster details without requiring a fantasy league sync.
 */
const express = require('express');
const router = express.Router();
const {
  scoreGameLog,
  scoringLabel,
  scoringSignature
} = require('../lib/fantasy-scoring');

const SPORTS = {
  nfl: 'football/nfl',
  nba: 'basketball/nba'
};
const CACHE_TTL_MS = 10 * 60 * 1000;
const TEAM_FETCH_CONCURRENCY = 8;
const playerCache = new Map();
const statsCache = new Map();
const defenseCache = { expiresAt: 0, promise: null };

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
        teamName: team.displayName || [team.location, team.name].filter(Boolean).join(' '),
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

function categoryStat(categories, categoryName, statName) {
  const category = (categories || []).find(item => item.name === categoryName);
  const stat = category?.stats?.find(item => item.name === statName);
  const value = Number(stat?.value);
  return Number.isFinite(value) ? value : 0;
}

function pointsAllowedBonus(points) {
  if (points === 0) return 10;
  if (points <= 6) return 7;
  if (points <= 13) return 4;
  if (points <= 17) return 1;
  if (points <= 27) return 0;
  if (points <= 34) return -1;
  return -4;
}

async function buildDefenseList(teamAbbreviation = '') {
  const data = await fetchEspnJson(
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=100'
  );
  const teams = data.sports?.[0]?.leagues?.[0]?.teams
    ?.map(entry => entry.team)
    .filter(team => team?.id && team.abbreviation && team.isActive !== false &&
      (!teamAbbreviation || team.abbreviation.toUpperCase() === teamAbbreviation.toUpperCase())) || [];
  if (!teams.length) throw new Error('ESPN did not return active NFL teams.');

  const results = new Array(teams.length);
  let cursor = 0;
  const workers = Array.from({ length: 8 }, async () => {
    while (cursor < teams.length) {
      const index = cursor++;
      const team = teams[index];
      try {
        const [statistics, schedule] = await Promise.all([
          fetchEspnJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.id}/statistics`),
          fetchEspnJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${team.id}/schedule`)
        ]);
        const categories = statistics.results?.stats?.categories || [];
        const games = (schedule.events || []).flatMap(event => event.competitions || [])
          .filter(competition => competition.status?.type?.completed)
          .map(competition => {
            const opponent = (competition.competitors || []).find(item => String(item.id) !== String(team.id));
            const pointsAllowed = Number(
              typeof opponent?.score === 'object'
                ? (opponent.score.value ?? opponent.score.displayValue)
                : opponent?.score
            );
            return Number.isFinite(pointsAllowed) ? pointsAllowed : null;
          }).filter(Number.isFinite);
        const gamesPlayed = games.length || categoryStat(categories, 'general', 'gamesPlayed');
        if (!gamesPlayed) throw new Error('No completed games in ESPN team data.');

        const sacks = categoryStat(categories, 'defensive', 'sacks') / gamesPlayed;
        const interceptions = categoryStat(categories, 'defensiveInterceptions', 'interceptions') / gamesPlayed;
        const recoveries = categoryStat(categories, 'general', 'fumblesRecovered') / gamesPlayed;
        const defensiveTouchdowns = (
          categoryStat(categories, 'defensive', 'miscTouchdowns') +
          categoryStat(categories, 'defensiveInterceptions', 'interceptionTouchdowns') +
          categoryStat(categories, 'general', 'fumblesTouchdowns') +
          categoryStat(categories, 'returning', 'kickReturnTouchdowns') +
          categoryStat(categories, 'returning', 'puntReturnTouchdowns')
        ) / gamesPlayed;
        const allowedBonus = games.length
          ? games.reduce((sum, points) => sum + pointsAllowedBonus(points), 0) / games.length
          : 0;
        const projectedPoints = Number((
          sacks + interceptions * 2 + recoveries * 2 + defensiveTouchdowns * 6 + allowedBonus
        ).toFixed(1));
        results[index] = {
          id: `dst-${team.id}`,
          full_name: `${team.displayName || team.abbreviation} D/ST`,
          position: 'D/ST',
          team: team.abbreviation,
          teamName: team.displayName || team.abbreviation,
          status: 'active',
          isDefense: true,
          seasonAverage: projectedPoints,
          recentAverage: null,
          projectedPoints,
          finalPoints: null,
          finalDate: '',
          gamesPlayed,
          scoringLabel: 'ESPN default D/ST estimate'
        };
      } catch (error) {
        results[index] = {
          id: `dst-${team.id}`,
          full_name: `${team.displayName || team.abbreviation} D/ST`,
          position: 'D/ST',
          team: team.abbreviation,
          teamName: team.displayName || team.abbreviation,
          status: 'active',
          isDefense: true,
          seasonAverage: null,
          recentAverage: null,
          projectedPoints: null,
          finalPoints: null,
          finalDate: '',
          gamesPlayed: 0,
          scoringLabel: 'ESPN default D/ST estimate',
          statsUnavailable: true
        };
      }
    }
  });
  await Promise.all(workers);
  return results.sort((a, b) => a.full_name.localeCompare(b.full_name));
}

async function getDefenseList() {
  if (defenseCache.promise && defenseCache.expiresAt > Date.now()) return defenseCache.promise;
  defenseCache.expiresAt = Date.now() + CACHE_TTL_MS;
  defenseCache.promise = buildDefenseList().catch(error => {
    defenseCache.expiresAt = 0;
    defenseCache.promise = null;
    throw error;
  });
  return defenseCache.promise;
}

async function getDefenseForTeam(teamAbbreviation) {
  const data = await fetchEspnJson(
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=100'
  );
  const team = data.sports?.[0]?.leagues?.[0]?.teams?.map(entry => entry.team)
    .find(item => item?.abbreviation?.toUpperCase() === teamAbbreviation.toUpperCase());
  if (!team) throw new Error('ESPN did not find that NFL team.');
  const results = await buildDefenseList(team.abbreviation);
  return results;
}

function metricKeys(sport, position, names) {
  const nba = [
    'minutes', 'points', 'totalRebounds', 'assists',
    'steals', 'blocks', 'turnovers',
    'fieldGoalsMade-fieldGoalsAttempted',
    'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
    'freeThrowsMade-freeThrowsAttempted'
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
  const scoringKeys = sport === 'nba'
    ? ['points', 'fieldGoalsMade-fieldGoalsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted', 'rebounds', 'totalRebounds', 'assists', 'steals', 'blocks', 'turnovers']
    : [
      'passingYards', 'passingTouchdowns', 'interceptions', 'fumblesLost',
      'rushingYards', 'rushingTouchdowns', 'receptions', 'receivingYards',
      'receivingTouchdowns', 'fieldGoalsMade-fieldGoalAttempts',
      'fieldGoalsMade1_19-fieldGoalAttempts1_19',
      'fieldGoalsMade20_29-fieldGoalAttempts20_29',
      'fieldGoalsMade30_39-fieldGoalAttempts30_39',
      'fieldGoalsMade40_49-fieldGoalAttempts40_49',
      'fieldGoalsMade50-fieldGoalAttempts50',
      'extraPointsMade-extraPointAttempts', 'longFieldGoalMade'
    ];
  return [...new Set([...keys, ...scoringKeys])].filter(key => names.includes(key));
}

async function buildPlayerStats(sport, player, scoringSettings) {
  const leaguePath = SPORTS[sport];
  const url = `https://site.web.api.espn.com/apis/common/v3/sports/${leaguePath}/athletes/${encodeURIComponent(player.id)}/gamelog?region=us&lang=en-US&contentorigin=espn&isqualified=false`;
  const data = await fetchEspnJson(url);
  const regularSeason = (data.seasonTypes || []).find(season =>
    season.displayName?.includes('Regular Season')
  );
  const events = (regularSeason?.categories || []).flatMap(category => category.events || []);
  const keys = metricKeys(sport, player.position, data.names || []);
  const fantasyScores = events.map(event => scoreGameLog(sport, data.names || [], event.stats || [], scoringSettings, player.position));
  const validFantasyScores = fantasyScores.filter(Number.isFinite);
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
      fantasyPoints: scoreGameLog(sport, data.names || [], event.stats || [], scoringSettings, player.position),
      values: keys.map(key => {
        const index = data.names.indexOf(key);
        return { label: labels.get(key), value: event.stats?.[index] ?? '—' };
      })
    };
  }).filter(game => game.values.length);

  const recentGames = games.slice(0, 5);
  const recentFantasyScores = recentGames
    .map(game => game.fantasyPoints)
    .filter(Number.isFinite);
  const recentFantasyPointsAverage = recentFantasyScores.length
    ? Number((recentFantasyScores.reduce((sum, value) => sum + value, 0) / recentFantasyScores.length).toFixed(1))
    : null;
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
    fantasyPointsAverage: validFantasyScores.length
      ? Number((validFantasyScores.reduce((sum, value) => sum + value, 0) / validFantasyScores.length).toFixed(1))
      : null,
    recentFantasyPointsAverage,
    fantasyScoring: scoringLabel(sport, scoringSettings),
    lastFinalPoints: games[0]?.fantasyPoints ?? null,
    lastFinalDate: games[0]?.date || '',
    averages,
    recentGames
  };
}

async function getPlayerStats(sport, player, scoringSettings) {
  const cacheKey = `${sport}:${player.id}:${scoringSignature(sport, scoringSettings)}`;
  const existing = statsCache.get(cacheKey);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;

  const entry = { expiresAt: Date.now() + CACHE_TTL_MS };
  entry.promise = buildPlayerStats(sport, player, scoringSettings).catch(error => {
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

router.get('/teams/nfl', async (req, res) => {
  try {
    const players = await getPlayerList('nfl');
    const teams = [...new Map(players.map(player => [
      player.team,
      { abbreviation: player.team, name: player.teamName || player.team }
    ])).values()].sort((a, b) => a.name.localeCompare(b.name));
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ teams });
  } catch (error) {
    res.status(502).json({ error: `Could not load NFL teams: ${error.message}` });
  }
});

router.get('/teams/nfl/defenses', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=600');
    const abbreviation = String(req.query.team || '').trim().slice(0, 4);
    res.json({ teams: abbreviation ? await getDefenseForTeam(abbreviation) : await getDefenseList() });
  } catch (error) {
    res.status(502).json({ error: `Could not load NFL defenses: ${error.message}` });
  }
});

router.post('/players/:sport/stats', async (req, res) => {
  const sport = (req.params.sport || '').toLowerCase();
  if (!SPORTS[sport]) {
    return res.status(400).json({ error: "sport must be 'nfl' or 'nba'" });
  }
  const ids = [...new Set((Array.isArray(req.body?.playerIds) ? req.body.playerIds : [])
    .map(id => String(id).slice(0, 40))
    .filter(id => /^\d{1,40}$/.test(id)))].slice(0, 30);
  if (!ids.length) return res.status(400).json({ error: 'Choose at least one player.' });

  try {
    const players = await getPlayerList(sport);
    const byId = new Map(players.map(player => [player.id, player]));
    let cursor = 0;
    const results = new Array(ids.length);
    const workers = Array.from({ length: Math.min(6, ids.length) }, async () => {
      while (cursor < ids.length) {
        const index = cursor++;
        const player = byId.get(ids[index]);
        if (!player) {
          results[index] = { id: ids[index], error: 'Player not found on a current team roster.' };
          continue;
        }
        try {
          const stats = await getPlayerStats(sport, player, req.body?.scoringSettings);
          const seasonAverage = stats.fantasyPointsAverage;
          const recentAverage = stats.recentFantasyPointsAverage;
          const projectedPoints = Number.isFinite(seasonAverage)
            ? Number((seasonAverage * 0.7 + (Number.isFinite(recentAverage) ? recentAverage : seasonAverage) * 0.3).toFixed(1))
            : null;
          results[index] = {
            id: player.id,
            fullName: player.full_name,
            position: player.position,
            team: player.team,
            status: player.status,
            seasonAverage,
            recentAverage,
            projectedPoints,
            finalPoints: stats.lastFinalPoints,
            finalDate: stats.lastFinalDate,
            gamesPlayed: stats.gamesPlayed,
            scoringLabel: stats.fantasyScoring
          };
        } catch (error) {
          results[index] = { id: player.id, error: `Player stats unavailable: ${error.message}` };
        }
      }
    });
    await Promise.all(workers);
    res.set('Cache-Control', 'no-store');
    res.json({ sport, players: results });
  } catch (error) {
    res.status(502).json({ error: `Could not load ${sport.toUpperCase()} player stats: ${error.message}` });
  }
});

router.post('/compare', async (req, res) => {
  const { sport = 'nfl', playerA, playerB, scoringSettings } = req.body || {};
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
      getPlayerStats(sport, a, scoringSettings),
      getPlayerStats(sport, b, scoringSettings)
    ]);
    const statsResult = (result) => result.status === 'fulfilled'
      ? result.value
      : { error: `Recent stats unavailable: ${result.reason.message}` };

    const valueA = statsA.status === 'fulfilled' ? statsA.value.fantasyPointsAverage : null;
    const valueB = statsB.status === 'fulfilled' ? statsB.value.fantasyPointsAverage : null;
    const label = scoringLabel(sport, scoringSettings);
    let verdict = 'Compare the recent games and season averages when choosing your lineup.';
    if (Number.isFinite(valueA) && Number.isFinite(valueB)) {
      if (valueA > valueB) verdict = `${a.full_name} is the better fantasy player this season: ${valueA} vs ${valueB} fantasy points per game (${label}).`;
      else if (valueB > valueA) verdict = `${b.full_name} is the better fantasy player this season: ${valueB} vs ${valueA} fantasy points per game (${label}).`;
      else verdict = `These players are tied at ${valueA} fantasy points per game (${label}).`;
    } else if (Number.isFinite(valueA) || Number.isFinite(valueB)) {
      verdict = `Only one player has a current-season fantasy average available (${label}).`;
    }

    res.json({
      sport,
      scoringLabel: label,
      comparison: {
        playerA: { fullName: a.full_name, position: a.position, team: a.team, jersey: a.jersey, status: a.status, stats: statsResult(statsA) },
        playerB: { fullName: b.full_name, position: b.position, team: b.team, jersey: b.jersey, status: b.status, stats: statsResult(statsB) },
        verdict
      }
    });
  } catch (error) {
    res.status(502).json({ error: `Could not compare ${sport.toUpperCase()} players: ${error.message}` });
  }
});

module.exports = router;
module.exports.getPlayerList = getPlayerList;
module.exports.getPlayerStats = getPlayerStats;
