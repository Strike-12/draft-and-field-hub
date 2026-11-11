# Draft & Field Hub

A responsive, multi-sport fantasy web app for NFL and NBA tracking, with 1-tap ESPN Fantasy league sync.

## Phase branches (built in order, each on top of the previous)
| Phase | Branch | Contents |
|---|---|---|
| 1 | `p-1` | Core foundation & static UI shell (Turf & Midnight theme) |
| 2 | `p-2` | ESPN sync — `POST /api/sync/espn` with SWID / espn_s2 cookie auth, PostgreSQL schema + in-memory fallback |
| 3 | `p-3` | Live top performers feed + dark/light theme toggle |
| 4 | `p-4` | Quick Compare tool |
| 5 | `p-5` | AI Start/Sit Assistant (Mistral API with heuristic fallback) |
| 6 | `p-6` | Build My Team — zero-entry projected dream teams + one-button league sync |

All phases are merged into `main` (PR #4).

## Features
- Build My Team: instant projected dream teams, zero entry
- Connect Your Fantasy League: one-button ESPN sync (public leagues need nothing; private leagues ask for a one-time connect because ESPN requires it)
- Live Top Performers feed, Quick Compare, AI Start/Sit Assistant
- Turf & Midnight theme with dark/light toggle

## Run
```bash
npm install
npm start          # http://localhost:3000
```

## Optional configuration
- `DATABASE_URL` — PostgreSQL connection string; without it an in-memory store is used (`db/schema.sql` has the schema).
- `MISTRAL_API_KEY` — enables real AI advice in the Start/Sit Assistant (heuristic fallback otherwise).
- `ESPN_SEASON` — fantasy season year (default 2026).
