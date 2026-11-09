/**
 * Draft & Field Hub — lightweight Express server
 * Phase 1: serves the static frontend.
 * Phase 2: ESPN sync integration.
 */
const express = require('express');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Draft & Field Hub', phase: 2 });
});

/**
 * POST /api/sync/espn
 * Sync ESPN Fantasy league roster
 * 
 * Request body: { leagueId, swid, espnS2, sport }
 * 
 * ESPN API endpoint pattern:
 * NFL: https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{leagueId}?view=mRoster
 * NBA: https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{year}/segments/0/leagues/{leagueId}?view=mRoster
 */
app.post('/api/sync/espn', async (req, res) => {
  try {
    const { leagueId, swid, espnS2, sport = 'nfl' } = req.body;
    
    // Validate required fields
    if (!leagueId || !swid || !espnS2) {
      return res.status(400).json({ 
        error: 'Missing required fields: leagueId, swid, and espnS2 are required' 
      });
    }
    
    // Determine ESPN API parameters based on sport
    const year = new Date().getFullYear();
    const gameCode = sport === 'nba' ? 'fba' : 'ffl';
    const segment = sport === 'nba' ? '0' : '0';
    
    // Construct ESPN API URL
    const espnUrl = new URL(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${gameCode}/seasons/${year}/segments/${segment}/leagues/${leagueId}`
    );
    espnUrl.searchParams.append('view', 'mRoster');
    espnUrl.searchParams.append('view', 'mSettings');
    
    // ESPN API request options
    const options = {
      hostname: espnUrl.hostname,
      path: espnUrl.pathname + espnUrl.search,
      method: 'GET',
      headers: {
        'Cookie': `SWID=${swid}; espn_s2=${espnS2}`,
        'x-fantasy-filter': JSON.stringify({})
      }
    };
    
    // Make request to ESPN API
    const espnReq = https.request(options, (espnRes) => {
      let data = '';
      
      espnRes.on('data', (chunk) => {
        data += chunk;
      });
      
      espnRes.on('end', () => {
        if (espnRes.statusCode === 200) {
          try {
            const rosterData = JSON.parse(data);
            // Extract and format roster information
            const formattedRoster = formatRosterData(rosterData, sport);
            
            res.json({
              success: true,
              roster: formattedRoster,
              league: {
                id: leagueId,
                name: rosterData.settings?.name || 'My League',
                sport
              }
            });
          } catch (parseError) {
            console.error('Failed to parse ESPN response:', parseError);
            res.status(500).json({ 
              error: 'Failed to parse ESPN API response' 
            });
          }
        } else {
          console.error(`ESPN API returned status ${espnRes.statusCode}: ${data}`);
          res.status(espnRes.statusCode).json({
            error: `ESPN API error: ${espnRes.statusCode}`,
            details: data
          });
        }
      });
    });
    
    espnReq.on('error', (error) => {
      console.error('ESPN API request failed:', error);
      res.status(502).json({
        error: 'Failed to connect to ESPN API',
        details: error.message
      });
    });
    
    espnReq.end();
    
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({
      error: 'Internal server error during sync',
      details: error.message
    });
  }
});

/**
 * Format ESPN roster data into a simplified structure
 */
function formatRosterData(espnData, sport) {
  const roster = espnData.teams?.[0]?.roster || [];
  const formatted = [];
  
  // Map ESPN position IDs to standard positions
  const positionMap = {
    // NFL positions
    '1': 'QB',   // Quarterback
    '2': 'RB',   // Running Back
    '3': 'WR',   // Wide Receiver
    '4': 'TE',   // Tight End
    '5': 'K',    // Kicker
    '16': 'D/ST', // Defense/Special Teams
    // NBA positions
    'PG': 'PG',
    'SG': 'SG',
    'SF': 'SF',
    'PF': 'PF',
    'C': 'C',
    'G': 'G',
    'F': 'F',
    'UTIL': 'UTIL'
  };
  
  for (const player of roster) {
    if (player && player.player) {
      const p = player.player;
      const slot = player.slot || player.lineupSlot || 0;
      
      formatted.push({
        id: p.id,
        fullName: p.fullName,
        firstName: p.firstName,
        lastName: p.lastName,
        position: positionMap[p.defaultPositionId?.toString()] || p.defaultPositionId?.toString() || 'Unknown',
        team: p.proTeamId?.toString() || p.proTeam?.abbrev || 'FA',
        jersey: p.jersey,
        slot: slot,
        isStarter: slot > 0,
        status: p.injuryStatus || 'ACTIVE',
        stats: p.stats || []
      });
    }
  }
  
  return formatted;
}

app.listen(PORT, () => {
  console.log(`Draft & Field Hub listening on http://localhost:${PORT}`);
});

module.exports = app;
