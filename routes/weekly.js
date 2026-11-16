const express = require('express');
const router = express.Router();
const { scoreBoxScore, scoringSignature } = require('../lib/fantasy-scoring');
const { getPlayerList, getPlayerStats } = require('./compare');

const SPORTS = {
  nfl: 'football/nfl',
  nba: 'basketball/nba'
};
const WEEK_CACHE_MS = 90 * 1000;
const weeklyCache = new Map();

async function fetchEspnJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
  return response.json();
}

function parseWeekStart(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function formatEspnDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function eventState(event) {
  return event.status?.type || event.competitions?.[0]?.status?.type || {};
}

function gameStatus(event) {
  const state = eventState(event);
  if (state.state === 'in' || state.name === 'STATUS_IN_PROGRESS') return 'LIVE';
  if (state.completed === true || state.state === 'post') return 'FINAL';
  return 'SCHEDULED';
}

async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await callback(items[index]);
      } catch (error) {
        results[index] = { error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchWeekScoreboards(sport, leaguePath, start) {
  const dates = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    return formatEspnDate(date);
  });
  let cursor = 0;
  const results = [];
  const failures = [];
  const workers = Array.from({ length: 4 }, async () => {
    while (cursor < dates.length) {
      const date = dates[cursor++];
      try {
        const scoreboard = await fetchEspnJson(
          `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/scoreboard?dates=${date}`
        );
        results.push(scoreboard);
      } catch (error) {
        failures.push(date);
      }
    }
  });
  await Promise.all(workers);
  if (!results.length) throw new Error(`${sport.toUpperCase()} weekly schedule was unavailable.`);

  const eventsById = new Map();
  const byeTeams = new Set();
  for (const scoreboard of results) {
    for (const team of scoreboard.week?.teamsOnBye || []) {
      if (team.abbreviation) byeTeams.add(team.abbreviation);
    }
    for (const event of scoreboard.events || []) eventsById.set(String(event.id), event);
  }
  const events = [...eventsById.values()].sort(
    (a, b) => Date.parse(a.date || '') - Date.parse(b.date || '')
  );
  const weekNumbers = [...new Set(events
    .map(event => Number(event.week?.number))
    .filter(Number.isInteger))];
  return {
    events,
    byeTeams,
    weekNumber: weekNumbers.length === 1 ? weekNumbers[0] : null,
    failedDates: failures
  };
}

function summaryAthletes(summary) {
  const athletes = new Map();
  for (const teamGroup of summary.boxscore?.players || []) {
    for (const statGroup of teamGroup.statistics || []) {
      for (const player of statGroup.athletes || []) {
        const id = String(player.athlete?.id || '');
        if (!id) continue;
        if (!athletes.has(id)) {
          athletes.set(id, {
            position: player.athlete?.position?.abbreviation || '',
            groups: []
          });
        }
        athletes.get(id).groups.push({
          keys: statGroup.keys || [],
          stats: player.stats || []
        });
      }
    }
  }
  return athletes;
}

async function buildWeeklyOutlook(sport, start, requestedPlayers, scoringSettings) {
  const leaguePath = SPORTS[sport];
  const weekEnd = new Date(start);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const startLabel = start.toISOString().slice(0, 10);
  const endLabel = weekEnd.toISOString().slice(0, 10);
  const scoringKey = scoringSignature(sport, scoringSettings);
  const idsKey = requestedPlayers.map(player =>
    `${player.id}:${player.slotType}:${player.team}`
  ).sort().join('|');
  const cacheKey = `${sport}:${startLabel}:${scoringKey}:${idsKey}`;
  const cached = weeklyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const entry = { expiresAt: Date.now() + WEEK_CACHE_MS };
  entry.promise = (async () => {
    const [schedule, roster] = await Promise.all([
      fetchWeekScoreboards(sport, leaguePath, start),
      getPlayerList(sport)
    ]);
    const rosterById = new Map(roster.map(player => [player.id, player]));
    const gamesByTeam = new Map();
    const games = schedule.events.map(event => {
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors || [];
      const home = competitors.find(team => team.homeAway === 'home') || competitors[0];
      const away = competitors.find(team => team.homeAway === 'away') || competitors[1];
      const game = {
        id: String(event.id),
        name: event.name || competition?.name || 'Scheduled game',
        date: event.date || competition?.date || '',
        status: gameStatus(event),
        statusDetail: eventState(event).shortDetail || eventState(event).detail || '',
        homeTeam: home?.team?.abbreviation || '',
        awayTeam: away?.team?.abbreviation || '',
        weekNumber: event.week?.number || schedule.weekNumber || null
      };
      [game.homeTeam, game.awayTeam].filter(Boolean).forEach(abbreviation => {
        if (!gamesByTeam.has(abbreviation)) gamesByTeam.set(abbreviation, []);
        gamesByTeam.get(abbreviation).push(game);
      });
      return game;
    });
    const requestedIds = new Set(requestedPlayers.map(player => player.id));
    const actualByPlayer = new Map();
    const actualGamesByPlayer = new Map();
    let failedSummaries = 0;
    const playedEvents = schedule.events.filter(event => {
      const state = eventState(event);
      return state.state === 'in' || state.name === 'STATUS_IN_PROGRESS' ||
        state.completed === true || state.state === 'post';
    });
    await mapWithConcurrency(playedEvents, 4, async event => {
      try {
        const summary = await fetchEspnJson(
          `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/summary?event=${encodeURIComponent(event.id)}`
        );
        const athletes = summaryAthletes(summary);
        for (const [id, athlete] of athletes) {
          if (!requestedIds.has(id)) continue;
          const points = scoreBoxScore(sport, athlete.groups, scoringSettings, athlete.position);
          if (!Number.isFinite(points)) continue;
          actualByPlayer.set(id, (actualByPlayer.get(id) || 0) + points);
          actualGamesByPlayer.set(id, (actualGamesByPlayer.get(id) || 0) + 1);
        }
      } catch {
        failedSummaries++;
      }
    });

    const players = await mapWithConcurrency(requestedPlayers, 6, async requestPlayer => {
      const player = rosterById.get(requestPlayer.id);
      const slotType = requestPlayer.slotType;
      if (!player) {
        const isDefense = /^dst-\d+$/.test(requestPlayer.id) ||
          String(slotType).toUpperCase() === 'D/ST';
        return {
          id: requestPlayer.id,
          slotType,
          fullName: isDefense ? `${requestPlayer.team || 'NFL'} D/ST` : 'Player unavailable',
          position: isDefense ? 'D/ST' : '',
          team: requestPlayer.team || '',
          injuryStatus: isDefense ? 'Team defense' : 'Status unavailable',
          injuryNote: '',
          gameStatus: isDefense ? 'WEEKLY DATA UNAVAILABLE' : 'PLAYER UNAVAILABLE',
          opponents: [],
          gamesScheduled: 0,
          gamesPlayed: 0,
          projectedPoints: null,
          actualPoints: null,
          actualStatus: 'unavailable',
          note: isDefense
            ? 'Weekly D/ST fantasy scoring is not available from ESPN’s public player feed.'
            : 'This player is not on a current ESPN roster.'
        };
      }

      const playerGames = gamesByTeam.get(player.team) || [];
      const statResult = await getPlayerStats(sport, player, scoringSettings).catch(() => null);
      const seasonAverage = statResult?.fantasyPointsAverage;
      const recentAverage = statResult?.recentFantasyPointsAverage;
      const perGameEstimate = Number.isFinite(seasonAverage)
        ? seasonAverage * 0.7 + (Number.isFinite(recentAverage) ? recentAverage : seasonAverage) * 0.3
        : null;
      const isUnavailable = /^(out|injured reserve|injured|inactive|suspended|doubtful)$/i
        .test(String(player.injuryStatus || '').trim());
      const id = player.id;
      return {
        id,
        slotType,
        fullName: player.full_name,
        position: player.position,
        team: player.team,
        injuryStatus: player.injuryStatus || 'Status unavailable',
        injuryNote: player.injuryNote || '',
        injuryUpdatedAt: player.injuryUpdatedAt || '',
        gameStatus: playerGames.length
          ? [...new Set(playerGames.map(game => game.status))].join(' · ')
          : schedule.byeTeams.has(player.team) && sport === 'nfl' ? 'BYE' : 'NO GAME',
        opponents: [...new Set(playerGames.map(game => {
          return game.homeTeam === player.team ? game.awayTeam : game.homeTeam;
        }).filter(Boolean))],
        gamesScheduled: playerGames.length,
        gamesPlayed: actualGamesByPlayer.get(id) || 0,
        projectedPoints: Number.isFinite(perGameEstimate)
          ? Number((perGameEstimate * playerGames.length).toFixed(1))
          : playerGames.length === 0 ? 0 : null,
        actualPoints: Number((actualByPlayer.get(id) || 0).toFixed(1)),
        actualStatus: 'points through completed/live games',
        isUnavailable
      };
    });

    return {
      sport,
      weekStart: startLabel,
      weekEnd: endLabel,
      weekNumber: schedule.weekNumber,
      updatedAt: new Date().toISOString(),
      scoringLabel: require('../lib/fantasy-scoring').scoringLabel(sport, scoringSettings),
      projectionNote: 'Estimate uses current-season fantasy average (70%) and recent average (30%), multiplied by games scheduled. It is not matchup-specific or an archived pregame projection.',
      actualNote: 'Actual points include completed games and current live scores for this week.',
      notes: [
        schedule.failedDates.length ? 'Some schedule dates could not be loaded.' : '',
        failedSummaries ? 'Some game scores could not be loaded.' : '',
        sport === 'nfl' && players.some(player => player.position === 'D/ST')
          ? 'Weekly D/ST fantasy points are unavailable from ESPN’s public player feed and are excluded from totals.'
          : ''
      ].filter(Boolean),
      games,
      players
    };
  })().catch(error => {
    weeklyCache.delete(cacheKey);
    throw error;
  });
  weeklyCache.set(cacheKey, entry);
  if (weeklyCache.size > 60) {
    const firstKey = weeklyCache.keys().next().value;
    weeklyCache.delete(firstKey);
  }
  return entry.promise;
}

router.post('/weekly/:sport', async (req, res) => {
  const sport = String(req.params.sport || '').toLowerCase();
  if (!SPORTS[sport]) return res.status(400).json({ error: "sport must be 'nfl' or 'nba'" });
  const start = parseWeekStart(req.body?.weekStart);
  if (!start) return res.status(400).json({ error: 'Choose a valid week.' });
  const players = [...new Map((Array.isArray(req.body?.players) ? req.body.players : [])
    .slice(0, 30)
    .map(player => {
      const id = String(player?.id || '').slice(0, 40);
      if (!/^(?:\d{1,40}|dst-\d{1,10})$/.test(id)) return null;
      return [id, {
        id,
        slotType: String(player.slotType || '').slice(0, 24),
        team: String(player.team || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)
      }];
    })
    .filter(Boolean)
  ).values()];

  try {
    const data = await buildWeeklyOutlook(sport, start, players, req.body?.scoringSettings);
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: `Could not load the weekly outlook: ${error.message}` });
  }
});

module.exports = router;
