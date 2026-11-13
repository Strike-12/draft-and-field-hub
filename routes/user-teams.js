const express = require('express');
const { randomUUID } = require('node:crypto');
const { getAuth } = require('@clerk/express');
const {
  listSavedTeams,
  saveSavedTeam,
  deleteSavedTeam
} = require('../db');
const { parsePublicLeagueUrl } = require('./buildteam');
const { cleanScoringSettings } = require('../lib/fantasy-scoring');

const router = express.Router();
const VALID_SPORTS = new Set(['nfl', 'nba']);
const VALID_SOURCES = new Set(['custom', 'generated', 'espn']);

function requireSignedIn(req, res, next) {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: 'Sign in to save and load your teams.' });
  req.clerkUserId = auth.userId;
  next();
}

function safePoints(value) {
  const parsed = Number(value);
  return value !== null && value !== '' && Number.isFinite(parsed) && Math.abs(parsed) <= 500
    ? parsed
    : null;
}

function cleanPlayer(player) {
  if (!player || typeof player !== 'object') return null;
  const fullName = String(player.fullName || '').trim().slice(0, 120);
  if (!fullName) return null;
  return {
    id: String(player.id || player.playerId || '').slice(0, 40),
    fullName,
    position: String(player.position || '—').slice(0, 20),
    team: String(player.team || '—').slice(0, 20),
    teamName: String(player.teamName || '').slice(0, 100),
    isDefense: Boolean(player.isDefense || String(player.position || '').toUpperCase() === 'D/ST'),
    slotType: String(player.slotType || player.suggestedSlot || 'BENCH').slice(0, 20),
    isStarter: Boolean(player.isStarter || player.is_starter || player.suggestedStarter),
    seasonAverage: safePoints(player.seasonAverage ?? player.fantasyPointsAverage),
    recentAverage: safePoints(player.recentAverage ?? player.recentFantasyPointsAverage),
    projectedPoints: safePoints(player.projectedPoints),
    finalPoints: safePoints(player.finalPoints),
    finalDate: String(player.finalDate || '').slice(0, 40),
    statsUnavailable: Boolean(player.statsUnavailable)
  };
}

function makeTeamData(input, leagueInfo) {
  const rosterInput = Array.isArray(input.roster) ? input.roster : [];
  if (!rosterInput.length || rosterInput.length > 30) {
    throw Object.assign(new Error('A team must contain between 1 and 30 players.'), { status: 400 });
  }
  const roster = rosterInput.map(cleanPlayer).filter(Boolean);
  if (!roster.length) {
    throw Object.assign(new Error('Add at least one player before saving this team.'), { status: 400 });
  }

  return {
    roster,
    slots: Array.isArray(input.slots) ? input.slots.slice(0, 30).map(slot => ({
      slotType: String(slot?.slotType || '').slice(0, 20),
      playerId: String(slot?.playerId || '').slice(0, 40)
    })) : [],
    projectedTotal: safePoints(input.projectedTotal),
    projectionBasis: String(input.projectionBasis || '').slice(0, 500),
    scoringLabel: String(input.scoringLabel || '').slice(0, 80),
    scoringSettings: cleanScoringSettings(input.scoringSettings),
    managerName: String(input.managerName || '').slice(0, 120),
    leagueUrl: leagueInfo?.leagueUrl || null,
    teamId: leagueInfo?.teamId || null,
    leagueId: leagueInfo?.leagueId || null,
    season: leagueInfo?.season || null
  };
}

router.get('/my-teams', requireSignedIn, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ teams: await listSavedTeams(req.clerkUserId) });
  } catch (error) {
    console.error('Could not load saved teams:', error.message);
    res.status(500).json({ error: 'Could not load your saved teams right now.' });
  }
});

router.post('/my-teams', requireSignedIn, async (req, res) => {
  try {
    const input = req.body || {};
    const sport = String(input.sport || '').toLowerCase();
    const source = String(input.source || '');
    if (!VALID_SPORTS.has(sport)) return res.status(400).json({ error: 'Choose NFL or NBA.' });
    if (!VALID_SOURCES.has(source)) return res.status(400).json({ error: 'Choose a supported team type.' });

    let providerKey;
    let leagueInfo = null;
    if (source === 'espn') {
      if (typeof input.leagueUrl !== 'string' || typeof input.teamId !== 'string') {
        return res.status(400).json({ error: 'The ESPN team details are invalid.' });
      }
      const league = parsePublicLeagueUrl(input.leagueUrl);
      const teamId = String(input.teamId || '');
      if (league.sport !== sport || !/^\d{1,12}$/.test(teamId)) {
        return res.status(400).json({ error: 'The ESPN team details are invalid.' });
      }
      providerKey = `espn:${sport}:${league.leagueId}:${league.season}:${teamId}`;
      leagueInfo = {
        leagueUrl: input.leagueUrl.slice(0, 1000),
        leagueId: league.leagueId,
        season: league.season,
        teamId
      };
    } else if (source === 'generated') {
      const requestedKey = String(input.providerKey || '');
      providerKey = /^generated:(nfl|nba):[a-z0-9-]{1,100}$/i.test(requestedKey)
        ? requestedKey
        : `generated:${sport}:${randomUUID()}`;
    } else {
      providerKey = `${source}:${sport}`;
    }

    const teamData = makeTeamData(input.teamData || {}, leagueInfo);
    const name = String(input.name || `${sport.toUpperCase()} ${source === 'custom' ? 'My Team' : 'Build'}`)
      .trim()
      .slice(0, 120);
    const savedTeam = await saveSavedTeam({
      clerkUserId: req.clerkUserId,
      sport,
      name: name || `${sport.toUpperCase()} Team`,
      source,
      providerKey,
      leagueName: String(input.leagueName || '').slice(0, 120) || null,
      teamData
    });
    res.status(200).json({ ok: true, team: savedTeam });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Could not save team:', error.message);
    res.status(500).json({ error: 'Could not save your team right now.' });
  }
});

router.delete('/my-teams/:id', requireSignedIn, async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid saved team.' });
  }
  try {
    const deleted = await deleteSavedTeam(req.clerkUserId, id);
    if (!deleted) return res.status(404).json({ error: 'Saved team was not found.' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Could not delete saved team:', error.message);
    res.status(500).json({ error: 'Could not delete this team right now.' });
  }
});

module.exports = router;
