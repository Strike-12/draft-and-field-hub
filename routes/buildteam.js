/**
 * Phase 6 — Build My Team.
 * GET /api/projections/:sport — projected dream team (zero entry, public data).
 * POST /api/sync/espn/auto    — looks up a public league by share link.
 * POST /api/sync/espn/team    — returns the manager's chosen team roster.
 */
const express = require('express');
const router = express.Router();
const { getPlayerList, getPlayerStats } = require('./compare');
const { cleanScoringSettings, scoringSignature } = require('../lib/fantasy-scoring');
const projectionCache = new Map();
const PROJECTION_CACHE_MS = 10 * 60 * 1000;

async function fetchEspnJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
  return response.json();
}

function nbaSeasonYear(scoreboard) {
  const year = Number(scoreboard.season?.year);
  if (Number.isInteger(year)) return year;
  return new Date().getUTCMonth() >= 9
    ? new Date().getUTCFullYear() + 1
    : new Date().getUTCFullYear();
}

async function getCandidateIds(sport) {
  if (sport === 'nfl') {
    const stats = await fetchEspnJson(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/statistics?region=us&lang=en-US&contentorigin=espn&seasontype=2'
    );
    const relevant = new Set([
      'passingYards', 'passingTouchdowns', 'rushingYards',
      'rushingTouchdowns', 'receptions', 'receivingYards',
      'receivingTouchdowns', 'totalPoints'
    ]);
    const ids = new Set();
    for (const category of stats.stats?.categories || []) {
      if (!relevant.has(category.name)) continue;
      for (const leader of (category.leaders || []).slice(0, 25)) {
        if (leader.athlete?.id) ids.add(String(leader.athlete.id));
      }
    }
    return [...ids];
  }

  const scoreboard = await fetchEspnJson(
    'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
  );
  const year = nbaSeasonYear(scoreboard);
  const leaders = await fetchEspnJson(
    `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${year}/types/2/leaders?lang=en&region=us`
  );
  const relevant = new Set([
    'pointsPerGame', 'assistsPerGame', 'reboundsPerGame',
    'stealsPerGame', 'blocksPerGame', '3PointsMadePerGame',
    'doubleDouble', 'minutesPerGame'
  ]);
  const ids = new Set();
  for (const category of leaders.categories || []) {
    if (!relevant.has(category.name)) continue;
    for (const leader of (category.leaders || []).slice(0, 25)) {
      const reference = leader.athlete?.$ref || '';
      const id = reference.match(/\/athletes\/(\d+)/)?.[1];
      if (id) ids.add(id);
    }
  }
  return [...ids];
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
        results[index] = null;
      }
    }
  });
  await Promise.all(workers);
  return results.filter(Boolean);
}

function selectSlots(sport, players, avoidPlayerIds = []) {
  const sorted = players.filter(player => Number.isFinite(player.projectedPoints))
    .sort((a, b) => b.projectedPoints - a.projectedPoints);
  const avoid = new Set(avoidPlayerIds.map(String));
  const used = new Set();
  const slots = [];
  const addSlot = (slotType, eligible) => {
    const matches = sorted.filter(candidate => !used.has(candidate.id) && eligible(candidate));
    const player = matches.find(candidate => !avoid.has(String(candidate.id))) || matches[0];
    if (player) {
      used.add(player.id);
      slots.push({ ...player, slotType });
    } else {
      slots.push({ slotType, player: null });
    }
  };

  if (sport === 'nfl') {
    addSlot('QB', player => player.position === 'QB');
    addSlot('RB1', player => player.position === 'RB');
    addSlot('RB2', player => player.position === 'RB');
    addSlot('WR1', player => player.position === 'WR');
    addSlot('WR2', player => player.position === 'WR');
    addSlot('TE', player => player.position === 'TE');
    addSlot('FLEX', player => ['RB', 'WR', 'TE'].includes(player.position));
    addSlot('K', player => ['K', 'PK'].includes(player.position));
    return {
      slots,
      note: 'NFL player stats do not include team defenses, so this projected lineup covers QB, RB, WR, TE, FLEX, and K.'
    };
  }

  addSlot('G1', player => ['G', 'PG', 'SG'].includes(player.position));
  addSlot('G2', player => ['G', 'PG', 'SG'].includes(player.position));
  addSlot('F1', player => ['F', 'SF', 'PF'].includes(player.position));
  addSlot('F2', player => ['F', 'SF', 'PF'].includes(player.position));
  addSlot('C', player => player.position === 'C');
  for (let index = 1; index <= 5; index++) addSlot(`UTIL${index}`, () => true);
  return { slots, note: 'NBA lineup uses two guards, two forwards, one center, and five flexible spots.' };
}

function canStart(player) {
  return !/^(out|injured reserve|injured|inactive|suspended|doubtful)$/i
    .test(String(player.injuryStatus || '').trim());
}

async function buildProjectedTeam(sport, scoringSettings, avoidPlayerIds = []) {
  const signature = scoringSignature(sport, scoringSettings);
  const avoidKey = [...new Set(avoidPlayerIds.map(String))].sort().join(',');
  const cacheKey = `${sport}:${signature}:${avoidKey}`;
  const cached = projectionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const entry = { expiresAt: Date.now() + PROJECTION_CACHE_MS };
  entry.promise = (async () => {
    const [players, candidateIds] = await Promise.all([
      getPlayerList(sport),
      getCandidateIds(sport)
    ]);
    const rosterById = new Map(players.map(player => [player.id, player]));
    const candidates = candidateIds.map(id => rosterById.get(id))
      .filter(player => player && (!player.status || player.status === 'active') && canStart(player));
    if (!candidates.length) throw new Error(`ESPN returned no current ${sport.toUpperCase()} stat leaders.`);

    const ranked = await mapWithConcurrency(candidates, 10, async player => {
      const stats = await getPlayerStats(sport, player, scoringSettings);
      if (!Number.isFinite(stats.fantasyPointsAverage)) return null;
      return {
        id: player.id,
        fullName: player.full_name,
        position: player.position,
        team: player.team,
        injuryStatus: player.injuryStatus,
        injuryNote: player.injuryNote,
        seasonAverage: stats.fantasyPointsAverage,
        recentAverage: stats.recentFantasyPointsAverage,
        projectedPoints: Number.isFinite(stats.fantasyPointsAverage)
          ? Number((stats.fantasyPointsAverage * 0.7 +
            (Number.isFinite(stats.recentFantasyPointsAverage)
              ? stats.recentFantasyPointsAverage
              : stats.fantasyPointsAverage) * 0.3).toFixed(1))
          : null,
        finalPoints: stats.lastFinalPoints,
        finalDate: stats.lastFinalDate
      };
    });
    const lineup = selectSlots(sport, ranked, avoidPlayerIds);
    return {
      sport,
      scoringLabel: require('../lib/fantasy-scoring').scoringLabel(sport, scoringSettings),
      projectionBasis: 'Estimated points/game blend current-season fantasy average (70%) and last-five-game average (30%). Latest final is shown separately.',
      note: lineup.note,
      projectedTeam: lineup.slots
    };
  })().catch(error => {
    projectionCache.delete(cacheKey);
    throw error;
  });
  projectionCache.set(cacheKey, entry);
  return entry.promise;
}

function parsePublicLeagueUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error('Paste a valid ESPN league share link.'), { status: 400 });
  }

  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (hostname !== 'espn.com' && !hostname.endsWith('.espn.com'))) {
    throw Object.assign(new Error('Use a secure link from espn.com.'), { status: 400 });
  }

  const sportMatch = url.pathname.match(/\/(football|basketball)\/(?:league|clubhouse|team)(?:\/|$)/i);
  if (!sportMatch) {
    throw Object.assign(new Error('Use the share link from your ESPN football or basketball league page.'), { status: 400 });
  }
  const sport = sportMatch[1].toLowerCase() === 'football' ? 'nfl' : 'nba';
  const pathLeagueId = url.pathname.match(/\/league\/(\d+)(?:\/|$)/i)?.[1];
  const leagueId = url.searchParams.get('leagueId') || pathLeagueId;
  if (!leagueId || !/^\d{1,12}$/.test(leagueId)) {
    throw Object.assign(new Error('This link is missing its league number. Copy the league share link from ESPN.'), { status: 400 });
  }

  const seasonId = url.searchParams.get('seasonId');
  if (seasonId && !/^\d{4}$/.test(seasonId)) {
    throw Object.assign(new Error('This ESPN link has an invalid season.'), { status: 400 });
  }
  const nflSeason = process.env.ESPN_SEASON || '2026';
  const defaultSeason = sport === 'nfl'
    ? nflSeason
    : process.env.ESPN_NBA_SEASON || String(Number(nflSeason) + 1);

  return {
    sport,
    leagueId,
    season: seasonId || defaultSeason,
    gameId: sport === 'nfl' ? 'ffl' : 'fba'
  };
}

async function getPublicLeague(league) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${league.gameId}/seasons/${league.season}/segments/0/leagues/${league.leagueId}?view=mRoster&view=mSettings`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw Object.assign(new Error('Could not reach ESPN. Please try again.'), { status: 502 });
  }
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error('This league is private. This password-free connection supports public leagues only.'), { status: 403 });
  }
  if (response.status === 404) {
    throw Object.assign(new Error('ESPN could not find this league for that season. Check the share link and season.'), { status: 404 });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`ESPN returned an error (${response.status}). Please try again.`), { status: 502 });
  }
  const data = await response.json();
  const memberById = new Map((data.members || []).flatMap(member => {
    const name = member.displayName ||
      [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
    return name && member.id ? [[String(member.id), name]] : [];
  }));
  const teams = (data.teams || []).map(team => ({
    id: String(team.id),
    name: team.name || [team.location, team.nickname].filter(Boolean).join(' ') || `Team ${team.id}`,
    managerName: (team.owners || []).map(owner => memberById.get(String(owner))).filter(Boolean).join(', ')
  }));
  if (!teams.length) {
    throw Object.assign(new Error('ESPN returned no teams for this public league.'), { status: 404 });
  }
  return {
    leagueName: data.settings?.name || `ESPN ${league.sport.toUpperCase()} league`,
    scoringSettings: cleanScoringSettings(data.settings?.scoringSettings),
    teams,
    data
  };
}

function getRosterForTeam(team, sport) {
  const positionMap = sport === 'nfl'
    ? { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' }
    : { 1: 'PG', 2: 'SG', 3: 'SF', 4: 'PF', 5: 'C' };
  const nflSlots = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 5: 'K', 7: 'FLEX', 22: 'FLEX', 20: 'BENCH', 21: 'IR' };
  const nbaSlots = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F', 7: 'UTIL', 8: 'BENCH', 9: 'IR' };
  const slots = sport === 'nfl' ? nflSlots : nbaSlots;
  const entries = team.roster?.entries || [];

  return entries.flatMap(entry => {
    const player = entry.playerPoolEntry?.player;
    if (!player?.fullName) return [];
    const slotType = slots[entry.lineupSlotId] || 'BENCH';
    return [{
      id: String(player.id || ''),
      fullName: player.fullName,
      position: positionMap[player.defaultPositionId] || '—',
      team: player.proTeamAbbreviation || '—',
      slotType,
      isStarter: slotType !== 'BENCH' && slotType !== 'IR'
    }];
  });
}

async function addFantasyStatsToRoster(sport, roster, scoringSettings) {
  let players;
  try {
    players = await getPlayerList(sport);
  } catch {
    return roster.map(player => ({
      ...player,
      injuryStatus: 'Status unavailable',
      injuryNote: '',
      projectedPoints: null,
      finalPoints: null,
      finalDate: '',
      statsUnavailable: true
    }));
  }
  const byId = new Map(players.map(player => [player.id, player]));
  return mapWithConcurrency(roster, 10, async rosterPlayer => {
    const currentPlayer = byId.get(rosterPlayer.id);
    if (!currentPlayer) return {
      ...rosterPlayer,
      injuryStatus: 'Status unavailable',
      injuryNote: '',
      projectedPoints: null,
      finalPoints: null,
      finalDate: '',
      statsUnavailable: true
    };
    try {
      const stats = await getPlayerStats(sport, currentPlayer, scoringSettings);
      return {
        ...rosterPlayer,
        injuryStatus: currentPlayer.injuryStatus,
        injuryNote: currentPlayer.injuryNote,
        projectedPoints: stats.fantasyPointsAverage,
        finalPoints: stats.lastFinalPoints,
        finalDate: stats.lastFinalDate,
        statsUnavailable: false
      };
    } catch {
      return {
        ...rosterPlayer,
        injuryStatus: currentPlayer.injuryStatus,
        injuryNote: currentPlayer.injuryNote,
        projectedPoints: null,
        finalPoints: null,
        finalDate: '',
        statsUnavailable: true
      };
    }
  });
}

function sendLeagueError(res, error) {
  return res.status(error.status || 502).json({
    error: error.status ? error.message : 'Could not load this ESPN league. Check the share link and try again.'
  });
}

async function sendProjections(req, res) {
  const sport = (req.params.sport || '').toLowerCase();
  if (!['nfl', 'nba'].includes(sport)) return res.status(400).json({ error: "sport must be 'nfl' or 'nba'" });
  try {
    const avoidPlayerIds = Array.isArray(req.body?.avoidPlayerIds)
      ? req.body.avoidPlayerIds.map(String).filter(id => /^\d{1,40}$/.test(id)).slice(0, 30)
      : [];
    const result = await buildProjectedTeam(sport, req.body?.scoringSettings, avoidPlayerIds);
    res.set('Cache-Control', req.method === 'GET' ? 'public, max-age=600' : 'no-store');
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: `Could not build a ${sport.toUpperCase()} lineup: ${error.message}` });
  }
}

router.get('/projections/:sport', sendProjections);
router.post('/projections/:sport', sendProjections);

// Preview an ESPN public league from its share link. No ESPN credentials are accepted.
router.post('/sync/espn/auto', async (req, res) => {
  let league;
  try {
    league = parsePublicLeagueUrl(req.body?.leagueUrl);
    const result = await getPublicLeague(league);
    res.json({
      ok: true,
      sport: league.sport,
      leagueName: result.leagueName,
      scoringSettings: result.scoringSettings,
      teams: result.teams
    });
  } catch (err) {
    sendLeagueError(res, err);
  }
});

router.post('/sync/espn/team', async (req, res) => {
  try {
    const league = parsePublicLeagueUrl(req.body?.leagueUrl);
    const teamId = String(req.body?.teamId || '');
    if (!/^\d{1,12}$/.test(teamId)) {
      return res.status(400).json({ error: 'Choose your team from the league list.' });
    }
    const result = await getPublicLeague(league);
    const team = result.data.teams?.find(candidate => String(candidate.id) === teamId);
    if (!team) return res.status(404).json({ error: 'That team was not found in this league.' });
    const roster = getRosterForTeam(team, league.sport);
    if (!roster.length) {
      return res.status(404).json({ error: 'ESPN did not return a roster for that team.' });
    }
    const rosterWithStats = await addFantasyStatsToRoster(league.sport, roster, result.scoringSettings);
    res.json({
      ok: true,
      sport: league.sport,
      leagueName: result.leagueName,
      teamName: result.teams.find(candidate => candidate.id === teamId)?.name,
      managerName: result.teams.find(candidate => candidate.id === teamId)?.managerName || '',
      scoringSettings: result.scoringSettings,
      roster: rosterWithStats
    });
  } catch (err) {
    sendLeagueError(res, err);
  }
});

module.exports = router;
module.exports.parsePublicLeagueUrl = parsePublicLeagueUrl;
module.exports.getRosterForTeam = getRosterForTeam;
module.exports.buildProjectedTeam = buildProjectedTeam;
