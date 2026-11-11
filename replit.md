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
- Without `MISTRAL_API_KEY`, advice uses the existing heuristic implementation after a roster is loaded.
- `ESPN_SEASON` defaults to `2026`.
- `ESPN_NBA_SEASON` can override the NBA fantasy season; by default it is one more than `ESPN_SEASON`.
- The ESPN connection accepts public league share links only. People must confirm permission, then choose their team. Passwords and cookies are never requested, and the selected roster is held in page memory only.
- `/api/sync/espn` is disabled; it no longer accepts SWID or `espn_s2` cookies.
- Quick Compare loads current NFL/NBA team rosters and regular-season game logs from ESPN, caches responses for ten minutes, and works without a fantasy sync. Search filters the full roster, while each dropdown renders at most 100 matches at once for responsiveness. Free agents outside team rosters are not included.

## Import recovery and limitations
- The imported main branch omitted required files. Restored the dependency manifest and data layer from `p-2`, ESPN/compare routes from `p-4`, feeds from `p-3`, and assistant from `p-5`.
- Kept the existing structure, appearance, and feature implementations.
- Corrected the invalid closing script tag in the imported HTML so its JavaScript executes.
- Public ESPN sync previews the league and lets a user choose which team roster to load. It does not store the share link or roster beyond the open page session. ESPN private leagues cannot be connected without an official authorization flow.
- Projected dream teams use the repository's fixed heuristic seeds, not live projections.

## Verification
- Confirmed the homepage and stylesheet load through the Replit development domain.
- Confirmed health, NFL/NBA projection, player-list, and live performer endpoints respond.
- Confirmed expected errors for invalid sports and missing public league/roster information.
- Confirmed the frontend script parses and the page renders in the browser.
- A real ESPN public-league link was not available for live end-to-end verification; use a public ESPN league link to test in Preview.
