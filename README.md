# Draft & Field Hub

A responsive, multi-sport fantasy web app for NFL and NBA tracking, with 1-tap ESPN Fantasy league sync.

## Phases
- **Phase 1** (`p-1`): Core foundation & static UI shell (Turf & Midnight theme)
- **Phase 2** (`p-2`): ESPN sync — `POST /api/sync/espn` with SWID / espn_s2 cookie auth
- **Phase 3** (`p-3`): Live top performers feed + dark/light theme toggle
- **Phase 4** (`p-4`): Quick Compare tool
- **Phase 5** (`p-5`): AI Start/Sit Assistant

## Run
```bash
npm install
npm start          # http://localhost:3000
```

## Optional configuration
- `DATABASE_URL` — PostgreSQL connection string; without it an in-memory store is used (`db/schema.sql` has the schema).
- `MISTRAL_API_KEY` — enables real AI advice in the Start/Sit Assistant (heuristic fallback otherwise).
- `ESPN_SEASON` — fantasy season year (default 2026).
