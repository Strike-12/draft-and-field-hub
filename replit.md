# Draft & Field Hub

## Run on Replit
- Existing stack: Node.js 20, Express, plain HTML/CSS/JavaScript.
- Use the **Run** button / **Start application** workflow, which runs `npm start`.
- The server binds to `0.0.0.0:5000`; `PORT` can override the port.
- No build step or required secrets are needed for the default development mode.
- Dependencies are recorded in `package.json` and `package-lock.json`.

## Product purpose
- Draft & Field Hub is for people who want to build a fantasy team in the app, check player stats, and see recent performance. Connecting an existing ESPN league is optional.

## Optional services
- Without `DATABASE_URL`, the original in-memory store is used. Stored rosters disappear when the process restarts.
- PostgreSQL is optional. Its original schema is in `db/schema.sql`; the schema still needs a unique constraint on `(sport, api_player_id)` before its player upsert can work. Database provisioning and schema changes were not part of the import setup.
- Without `MISTRAL_API_KEY`, advice uses the existing heuristic implementation after a roster is synced.
- `ESPN_SEASON` defaults to `2026`.
- Never put ESPN cookies or API keys in source control.
- Quick Compare loads current NFL/NBA team rosters and regular-season game logs from ESPN, caches responses for ten minutes, and works without a fantasy sync. Search filters the full roster, while each dropdown renders at most 100 matches at once for responsiveness. Free agents outside team rosters are not included.

## Import recovery and limitations
- The imported main branch omitted required files. Restored the dependency manifest and data layer from `p-2`, ESPN/compare routes from `p-4`, feeds from `p-3`, and assistant from `p-5`.
- Kept the existing structure, appearance, and feature implementations.
- Corrected the invalid closing script tag in the imported HTML so its JavaScript executes.
- The existing `/api/sync/espn/auto` endpoint checks league access but does not save or display a roster. The older `/api/sync/espn` saves NFL rosters, but uses a process-wide active user and overwrites each team's roster in turn. Treat this as a development preview, not a safe multi-user deployment.
- Projected dream teams use the repository's fixed heuristic seeds, not live projections.

## Verification
- Confirmed the homepage and stylesheet load through the Replit development domain.
- Confirmed health, NFL/NBA projection, player-list, and live performer endpoints respond.
- Confirmed expected errors for invalid sports, missing sync information, and advice without a synced roster.
- Confirmed the frontend script parses and the page renders in the browser.
- A real private-league sync and optional PostgreSQL/Mistral paths were not verified.
