/**
 * Phase 3 — Live top performers feed.
 * GET /api/performers/:sport  (nfl | nba)
 * Pulls live scoreboards from the public ESPN site API and returns the
 * current top fantasy performers for the sport.
 */
const express = require('express');
const router = express.Router();

const LEAGUES = {
  nfl: { path: 'football/nfl', abbr: 'NFL' },
  nba: { path: 'basketball/nba', abbr: 'NBA' }
};

router.get('/performers/:sport', async (req, res) => {
  const sport = (req.params.sport || '').toLowerCase();
  const league = LEAGUES[sport];
  if (!league) return res.status(400).json({ error: "sport must be 'nfl' or 'nba'" });

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('ESPN returned ' + r.status);
    const data = await r.json();

    const performers = [];
    for (const event of data.events || []) {
      for (const comp of event.competitions || []) {
        for (const competitor of comp.competitors || []) {
          const leaders = (competitor.leaders || []).flatMap(l => l.leaders || []);
          for (const leader of leaders) {
            performers.push({
              name: leader.athlete && leader.athlete.displayName,
              position: leader.name || '—',
              team: competitor.team && competitor.team.abbreviation,
              stat: leader.displayValue || '',
              event: `vs ${(comp.competitors || []).find(c => c !== competitor)?.team?.abbreviation || '?'}`
            });
          }
        }
      }
    }
    res.json({ sport, updated: new Date().toISOString(), performers: performers.slice(0, 10) });
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach ESPN: ' + err.message });
  }
});

module.exports = router;
