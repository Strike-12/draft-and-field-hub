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
