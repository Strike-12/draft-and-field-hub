-- Draft & Field Hub — PostgreSQL schema
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(80) NOT NULL,
  espn_league_id VARCHAR(40),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  sport VARCHAR(3) NOT NULL CHECK (sport IN ('nfl','nba')),
  api_player_id VARCHAR(40),
  full_name VARCHAR(120) NOT NULL,
  position VARCHAR(10) NOT NULL,
  team VARCHAR(10),
  status VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS user_rosters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport VARCHAR(3) NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot_type VARCHAR(10) NOT NULL,
  is_starter BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS saved_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id VARCHAR(255) NOT NULL,
  sport VARCHAR(3) NOT NULL CHECK (sport IN ('nfl', 'nba')),
  name VARCHAR(120) NOT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('custom', 'generated', 'espn')),
  provider_key VARCHAR(300) NOT NULL,
  league_name VARCHAR(120),
  team_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clerk_user_id, provider_key)
);

CREATE INDEX IF NOT EXISTS saved_teams_user_updated_idx
  ON saved_teams (clerk_user_id, updated_at DESC);
