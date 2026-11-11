/**
 * Current and recently completed top fantasy performers from ESPN scoreboards.
 * POST /api/performers/:sport accepts optional public-league scoring settings.
 */
const express = require('express');
const router = express.Router();
const {
  cleanScoringSettings,
  scoreBoxScore,
  scoringLabel,
  scoringSignature
} = require('../lib/fantasy-scoring');
const { getPlayerList } = require('./compare');

const LEAGUES = {
  nfl: { path: 'football/nfl', abbr: 'NFL' },
  nba: { path: 'basketball/nba', abbr: 'NBA' }
};
const FEED_CACHE_MS = 3 * 60 * 1000;
const feedCache = new Map();

async function fetchEspnJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`ESPN returned ${response.status}`);
  return response.json();
}

function eventState(event) {
  return event.status?.type || event.competitions?.[0]?.status?.type || {};
}

function playerHighlight(sport, groups) {
  const stats = {};
  for (const group of groups) {
    (group.keys || []).forEach((key, index) => { stats[key] = group.stats?.[index]; });
  }
  const keys = sport === 'nfl'
    ? ['passingYards', 'rushingYards', 'receivingYards', 'passingTouchdowns', 'rushingTouchdowns', 'receivingTouchdowns']
    : ['points', 'rebounds', 'assists', 'steals', 'blocks'];
  const parts = keys.filter(key => stats[key] !== undefined && stats[key] !== null)
    .slice(0, 3)
    .map(key => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()} ${stats[key]}`);
  return parts.join(' · ') || 'Game stats';
}

async function getFeed(sport, league, scoringSettings) {
  const signature = scoringSignature(sport, scoringSettings);
  const cacheKey = `${sport}:${signature}`;
  const cached = feedCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const entry = { expiresAt: Date.now() + FEED_CACHE_MS };
  entry.promise = (async () => {
    const data = await fetchEspnJson(`https://site.api.espn.com/apis/site/v2/sports/${league.path}/scoreboard`);
    const normalizedSettings = cleanScoringSettings(scoringSettings);
    const hasPositionOverrides = normalizedSettings?.scoringItems.some(item => item.pointsOverrides.length);
    const rosterById = hasPositionOverrides
      ? new Map((await getPlayerList(sport)).map(player => [player.id, player]))
      : new Map();
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const events = (data.events || []).filter(event => {
      const state = eventState(event);
      const live = state.state === 'in' || state.name === 'STATUS_IN_PROGRESS';
      const date = Date.parse(event.date || event.competitions?.[0]?.date || '');
      return live || (state.completed === true && Number.isFinite(date) && date >= cutoff);
    }).sort((a, b) => Date.parse(b.date || '') - Date.parse(a.date || '')).slice(0, 18);

    const completed = [];
    let cursor = 0;
    let successfulSummaries = 0;
    const workers = Array.from({ length: Math.min(6, events.length) }, async () => {
      while (cursor < events.length) {
        const event = events[cursor++];
        const competition = event.competitions?.[0];
        if (!competition) continue;
        const state = eventState(event);
        const isLive = state.state === 'in' || state.name === 'STATUS_IN_PROGRESS';
        let summary;
        try {
          summary = await fetchEspnJson(
            `https://site.api.espn.com/apis/site/v2/sports/${league.path}/summary?event=${encodeURIComponent(event.id)}`
          );
          successfulSummaries++;
        } catch {
          continue;
        }
        const athletes = new Map();
        for (const teamGroup of summary.boxscore?.players || []) {
          for (const statGroup of teamGroup.statistics || []) {
            for (const player of statGroup.athletes || []) {
              const id = String(player.athlete?.id || player.athlete?.uid || player.athlete?.displayName || '');
              if (!id) continue;
              if (!athletes.has(id)) {
                athletes.set(id, {
                  name: player.athlete?.displayName || player.athlete?.fullName || 'Unknown player',
                  position: player.athlete?.position?.abbreviation || rosterById.get(String(player.athlete?.id))?.position || '—',
                  team: teamGroup.team?.abbreviation || '—',
                  groups: []
                });
              }
              athletes.get(id).groups.push({ keys: statGroup.keys || [], stats: player.stats || [] });
            }
          }
        }

        const game = event.name || competition.name || 'Recent game';
        const date = event.date || competition.date || '';
        const competitors = competition.competitors || [];
        for (const player of athletes.values()) {
          const fantasyPoints = scoreBoxScore(sport, player.groups, scoringSettings, player.position);
          if (!Number.isFinite(fantasyPoints)) continue;
          const opponent = competitors.find(team => team.team?.abbreviation !== player.team)?.team?.abbreviation;
          completed.push({
            name: player.name,
            position: player.position,
            team: player.team,
            opponent: opponent || '',
            fantasyPoints: Number(fantasyPoints.toFixed(1)),
            stat: playerHighlight(sport, player.groups),
            event: opponent ? `vs ${opponent}` : game,
            date,
            gameStatus: isLive ? 'LIVE' : 'FINAL'
          });
        }
      }
    });
    await Promise.all(workers);
    if (events.length && !successfulSummaries) throw new Error('ESPN game summaries were unavailable.');

    completed.sort((a, b) => b.fantasyPoints - a.fantasyPoints || Date.parse(b.date) - Date.parse(a.date));
    return {
      sport,
      updated: new Date().toISOString(),
      scoringLabel: scoringLabel(sport, scoringSettings),
      performers: completed.slice(0, 10)
    };
  })().catch(error => {
    feedCache.delete(cacheKey);
    throw error;
  });
  feedCache.set(cacheKey, entry);
  return entry.promise;
}

async function handleFeed(req, res) {
  const sport = (req.params.sport || '').toLowerCase();
  const league = LEAGUES[sport];
  if (!league) return res.status(400).json({ error: "sport must be 'nfl' or 'nba'" });
  try {
    const scoringSettings = req.body?.scoringSettings;
    res.json(await getFeed(sport, league, scoringSettings));
  } catch (error) {
    res.status(502).json({ error: `Could not load recent ${league.abbr} performers: ${error.message}` });
  }
}

router.get('/performers/:sport', handleFeed);
router.post('/performers/:sport', handleFeed);

module.exports = router;
