/**
 * Phase 6 — Build My Team.
 * GET /api/projections/:sport — projected dream team (zero entry, public data).
 * POST /api/sync/espn/auto    — 1-button league sync. Tries a public-league
 * fetch first; only asks for a one-time connect if ESPN requires credentials.
 */
const express = require('express');
const router = express.Router();
const db = require('../db');

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

router.get('/projections/:sport', (req, res) => {
  const sport = (req.params.sport || '').toLowerCase();
  if (!['nfl', 'nba'].includes(sport)) return res.status(400).json({ error: "sport must be 'nfl' or 'nba'" });
  res.json({ sport, projectedTeam: PROJECTIONS[sport] });
});

// One-button sync. Public leagues need nothing; private leagues need a
// one-time connect (ESPN has no silent login, so credentials are unavoidable).
router.post('/sync/espn/auto', async (req, res) => {
  const { leagueId, swid, espnS2 } = req.body || {};
  if (!leagueId) {
    return res.status(400).json({
      needsConnect: true,
      message: 'ESPN needs a one-time connect for your league. Click Sync again after connecting.'
    });
  }
  // Reuse the Phase 2 sync logic server-side.
  const espn = require('./espn');
  const SEASON = process.env.ESPN_SEASON || '2026';
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${leagueId}?view=mRoster`;
  try {
    const r = await fetch(url, {
      headers: swid && espnS2 ? { Cookie: `SWID=${swid}; espn_s2=${espnS2};` } : {}
    });
    if (r.status === 401 || r.status === 403) {
      return res.status(401).json({
        needsConnect: true,
        message: 'This league is private — a one-time connect is required by ESPN.'
      });
    }
    if (!r.ok) return res.status(r.status).json({ error: 'ESPN returned ' + r.status });
    const league = await r.json();
    res.json({ ok: true, leagueName: league.settings && league.settings.name, teams: (league.teams || []).length });
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach ESPN: ' + err.message });
  }
});

module.exports = router;
