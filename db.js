/**
 * Draft & Field Hub — data layer.
 * Uses PostgreSQL when DATABASE_URL is set, otherwise an in-memory store
 * so the app runs out of the box for development.
 */
const USE_PG = !!process.env.DATABASE_URL;
let pool = null;
if (USE_PG) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
}

const mem = { users: [], players: [], rosters: [] };
let memIds = { users: 0, players: 0, rosters: 0 };
const savedTeamsMemory = new Map();

function serializeSavedTeam(row) {
  return {
    id: row.id,
    sport: row.sport,
    name: row.name,
    source: row.source,
    providerKey: row.provider_key,
    leagueName: row.league_name,
    teamData: row.team_data,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listSavedTeams(clerkUserId) {
  if (USE_PG) {
    const result = await pool.query(
      `SELECT id, sport, name, source, provider_key, league_name, team_data, created_at, updated_at
       FROM saved_teams
       WHERE clerk_user_id = $1
       ORDER BY updated_at DESC`,
      [clerkUserId]
    );
    return result.rows.map(serializeSavedTeam);
  }
  return [...savedTeamsMemory.values()]
    .filter(team => team.clerk_user_id === clerkUserId)
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .map(serializeSavedTeam);
}

async function saveSavedTeam(team) {
  if (USE_PG) {
    const result = await pool.query(
      `INSERT INTO saved_teams
         (clerk_user_id, sport, name, source, provider_key, league_name, team_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (clerk_user_id, provider_key)
       DO UPDATE SET
         sport = EXCLUDED.sport,
         name = EXCLUDED.name,
         source = EXCLUDED.source,
         league_name = EXCLUDED.league_name,
         team_data = EXCLUDED.team_data,
         updated_at = NOW()
       RETURNING id, sport, name, source, provider_key, league_name, team_data, created_at, updated_at`,
      [
        team.clerkUserId,
        team.sport,
        team.name,
        team.source,
        team.providerKey,
        team.leagueName || null,
        JSON.stringify(team.teamData)
      ]
    );
    return serializeSavedTeam(result.rows[0]);
  }

  const key = `${team.clerkUserId}:${team.providerKey}`;
  const old = savedTeamsMemory.get(key);
  const now = new Date();
  const row = {
    id: old?.id || require('node:crypto').randomUUID(),
    clerk_user_id: team.clerkUserId,
    sport: team.sport,
    name: team.name,
    source: team.source,
    provider_key: team.providerKey,
    league_name: team.leagueName || null,
    team_data: team.teamData,
    created_at: old?.created_at || now,
    updated_at: now
  };
  savedTeamsMemory.set(key, row);
  return serializeSavedTeam(row);
}

async function deleteSavedTeam(clerkUserId, id) {
  if (USE_PG) {
    const result = await pool.query(
      'DELETE FROM saved_teams WHERE clerk_user_id = $1 AND id = $2 RETURNING id',
      [clerkUserId, id]
    );
    return result.rowCount > 0;
  }
  for (const [key, team] of savedTeamsMemory) {
    if (team.clerk_user_id === clerkUserId && team.id === id) {
      savedTeamsMemory.delete(key);
      return true;
    }
  }
  return false;
}

async function createUser(username, espnLeagueId) {
  if (USE_PG) {
    const r = await pool.query(
      'INSERT INTO users (username, espn_league_id) VALUES ($1, $2) RETURNING id',
      [username, espnLeagueId]
    );
    return r.rows[0].id;
  }
  const id = ++memIds.users;
  mem.users.push({ id, username, espn_league_id: espnLeagueId, created_at: new Date() });
  return id;
}

async function upsertPlayer(sport, apiPlayerId, fullName, position, team) {
  if (USE_PG) {
    const r = await pool.query(
      `INSERT INTO players (sport, api_player_id, full_name, position, team)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (sport, api_player_id)
       DO UPDATE SET full_name = EXCLUDED.full_name, position = EXCLUDED.position, team = EXCLUDED.team
       RETURNING id`,
      [sport, String(apiPlayerId), fullName, position, team]
    );
    return r.rows[0].id;
  }
  let p = mem.players.find(x => x.sport === sport && x.api_player_id === String(apiPlayerId));
  if (!p) {
    p = { id: ++memIds.players, sport, api_player_id: String(apiPlayerId), full_name: fullName, position, team, status: 'active' };
    mem.players.push(p);
  } else {
    Object.assign(p, { full_name: fullName, position, team });
  }
  return p.id;
}

async function replaceRoster(userId, sport, entries) {
  if (USE_PG) {
    await pool.query('DELETE FROM user_rosters WHERE user_id = $1 AND sport = $2', [userId, sport]);
    for (const e of entries) {
      await pool.query(
        'INSERT INTO user_rosters (user_id, sport, player_id, slot_type, is_starter) VALUES ($1,$2,$3,$4,$5)',
        [userId, sport, e.playerId, e.slotType, e.isStarter]
      );
    }
    return;
  }
  mem.rosters = mem.rosters.filter(r => !(r.user_id === userId && r.sport === sport));
  entries.forEach(e => mem.rosters.push({ user_id: userId, sport, player_id: e.playerId, slot_type: e.slotType, is_starter: e.isStarter }));
}

async function getRoster(userId, sport) {
  if (USE_PG) {
    const r = await pool.query(
      `SELECT p.id, p.full_name, p.position, p.team, r.slot_type, r.is_starter
       FROM user_rosters r JOIN players p ON p.id = r.player_id
       WHERE r.user_id = $1 AND r.sport = $2 ORDER BY r.id`,
      [userId, sport]
    );
    return r.rows;
  }
  return mem.rosters
    .filter(r => r.user_id === userId && r.sport === sport)
    .map(r => {
      const p = mem.players.find(x => x.id === r.player_id) || {};
      return { id: p.id, full_name: p.full_name, position: p.position, team: p.team, slot_type: r.slot_type, is_starter: r.is_starter };
    });
}

module.exports = {
  USE_PG,
  createUser,
  upsertPlayer,
  replaceRoster,
  getRoster,
  listSavedTeams,
  saveSavedTeam,
  deleteSavedTeam
};
