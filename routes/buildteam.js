/**
 * Phase 6 — Build My Team.
 * GET /api/projections/:sport — projected dream team (zero entry, public data).
 * POST /api/sync/espn/auto    — looks up a public league by share link.
 * POST /api/sync/espn/team    — returns the manager's chosen team roster.
 */
const express = require('express');
const router = express.Router();

// Heuristic projection seeds (2026 season outlook). Zero-entry by design.
const PROJECTIONS = {
  nfl: [
    { full_name: 'Josh Allen', position: 'QB', team: 'BUF', proj: 24.8 },
    { full_name: 'Saquon Barkley', position: 'RB', team: 'PHI', proj: 19.1 },
    { full_name: 'Bijan Robinson', position: 'RB', team: 'ATL', proj: 18.4 },
    { full_name: 'Ja’Marr Chase', position: 'WR', team: 'CIN', proj: 21.6 },
    { full_name: 'Justin Jefferson', position: 'WR', team: 'MIN', proj: 20.2 },
    { full_name: 'Travis Kelce', position: 'TE', team: 'KC', proj: 12.5 },
    { full_name: 'De’Von Achane', position: 'FLEX', team: 'MIA', proj: 17.2 },
    { full_name: 'Ravens D/ST', position: 'D/ST', team: 'BAL', proj: 11.0 },
    { full_name: 'Justin Tucker', position: 'K', team: 'BAL', proj: 9.6 }
  ],
  nba: [
    { full_name: 'Nikola Jokic', position: 'C', team: 'DEN', proj: 32.4 },
    { full_name: 'Giannis Antetokounmpo', position: 'PF', team: 'MIL', proj: 33.8 },
    { full_name: 'Shai Gilgeous-Alexander', position: 'PG', team: 'OKC', proj: 31.5 },
    { full_name: 'Luka Doncic', position: 'PG', team: 'LAL', proj: 30.9 },
    { full_name: 'Jayson Tatum', position: 'SF', team: 'BOS', proj: 29.4 },
    { full_name: 'Anthony Edwards', position: 'SG', team: 'MIN', proj: 28.6 },
    { full_name: 'Victor Wembanyama', position: 'C', team: 'SAS', proj: 29.8 },
    { full_name: 'Stephen Curry', position: 'PG', team: 'GSW', proj: 27.3 },
    { full_name: 'Kevin Durant', position: 'SF', team: 'HOU', proj: 26.1 },
    { full_name: 'Tyrese Maxey', position: 'G', team: 'PHI', proj: 25.7 }
  ]
};

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
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${league.gameId}/seasons/${league.season}/segments/0/leagues/${league.leagueId}?view=mRoster`;
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
  const teams = (data.teams || []).map(team => ({
    id: String(team.id),
    name: team.name || [team.location, team.nickname].filter(Boolean).join(' ') || `Team ${team.id}`
  }));
  if (!teams.length) {
    throw Object.assign(new Error('ESPN returned no teams for this public league.'), { status: 404 });
  }
  return {
    leagueName: data.settings?.name || `ESPN ${league.sport.toUpperCase()} league`,
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
      fullName: player.fullName,
      position: positionMap[player.defaultPositionId] || '—',
      team: player.proTeamAbbreviation || '—',
      slotType,
      isStarter: slotType !== 'BENCH' && slotType !== 'IR'
    }];
  });
}

function sendLeagueError(res, error) {
  return res.status(error.status || 502).json({
    error: error.status ? error.message : 'Could not load this ESPN league. Check the share link and try again.'
  });
}

router.get('/projections/:sport', (req, res) => {
  const sport = (req.params.sport || '').toLowerCase();
  if (!['nfl', 'nba'].includes(sport)) return res.status(400).json({ error: "sport must be 'nfl' or 'nba'" });
  res.json({ sport, projectedTeam: PROJECTIONS[sport] });
});

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
    res.json({
      ok: true,
      sport: league.sport,
      leagueName: result.leagueName,
      teamName: result.teams.find(candidate => candidate.id === teamId)?.name,
      roster
    });
  } catch (err) {
    sendLeagueError(res, err);
  }
});

module.exports = router;
module.exports.parsePublicLeagueUrl = parsePublicLeagueUrl;
module.exports.getRosterForTeam = getRosterForTeam;
