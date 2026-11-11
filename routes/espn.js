/**
 * Phase 2 — ESPN Fantasy sync.
 * POST /api/sync/espn  { leagueId, swid, espnS2, username? }
 * Packages credentials into a Cookie header and pulls rosters from the
 * ESPN v3 fantasy API, persists them, and returns the mapped lineup.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');

const SEASON = process.env.ESPN_SEASON || '2026';
const SLOT_MAP = {
  0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 5: 'K', 7: 'FLEX', 22: 'FLEX'
};
const POS_MAP = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'D/ST' };

router.post('/sync/espn', async (req, res) => {
  const { leagueId, swid, espnS2, username } = req.body || {};
  if (!leagueId || !swid || !espnS2) {
    return res.status(400).json({ error: 'leagueId, swid and espnS2 are required.' });
  }

  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${leagueId}?view=mRoster`;
  try {
    const espnRes = await fetch(url, {
      headers: { Cookie: `SWID=${swid}; espn_s2=${espnS2};` }
    });
    if (!espnRes.ok) {
      return res.status(espnRes.status).json({ error: `ESPN returned ${espnRes.status}. Check your league ID and tokens.` });
    }
    const league = await espnRes.json();

    const userId = await db.createUser(username || `manager-${leagueId}`, String(leagueId));
    const teams = league.teams || [];
    const result = [];

    for (const team of teams) {
      const entries = (team.roster && team.roster.entries) || [];
      const dbEntries = [];
      for (const entry of entries) {
        const player = entry.playerPoolEntry && entry.playerPoolEntry.player;
        if (!player) continue;
        const slotId = entry.lineupSlotId;
        const position = POS_MAP[player.defaultPositionId] || `IDP-${player.defaultPositionId}`;
        const slotType = SLOT_MAP[slotId] || 'BENCH';
        const isStarter = slotId !== 20 && slotId !== 21; // 20/21 = bench
        const playerId = await db.upsertPlayer('nfl', player.id, player.fullName, position, `T${player.proTeamId}`);
        dbEntries.push({ playerId, slotType, isStarter });
        result.push({
          team: team.name || team.location + ' ' + team.nickname,
          fullName: player.fullName,
          position,
          slotType,
          isStarter
        });
      }
      await db.replaceRoster(userId, 'nfl', dbEntries);
    }

    res.json({ ok: true, userId, leagueName: league.settings && league.settings.name, teams: teams.length, roster: result });
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach ESPN: ' + err.message });
  }
});

module.exports = router;
