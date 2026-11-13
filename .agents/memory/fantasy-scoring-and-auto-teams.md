---
name: Fantasy scoring and auto-built teams
description: Product rules for no-sync fantasy teams, scoring, projections, and game results.
---

Build My Team should create an automatic NFL or NBA lineup without requiring ESPN sync. If a public ESPN league is connected, use its scoring settings; otherwise use ESPN's common defaults: NFL PPR and ESPN's default NBA points scoring. Estimate points from current-season and recent fantasy averages, keep the latest completed game's result separate, and make a repeated build produce an alternative lineup when possible.

After a user loads their ESPN roster, automatically recommend the best lineup from that roster using its available fantasy-point averages, and let them rebuild it from the connected team. Do not substitute a generic league-wide lineup for their team.

The custom NFL roster must have QB, two RB, two WR, TE, FLEX, D/ST, K, seven bench slots, and one IR slot. Search should include current team names and tolerate close player-name spelling. Show ESPN fantasy team names and manager names when available. Estimate D/ST from team season stats and clearly identify standard scoring as an estimate if league-specific defense rules differ.

**Why:** The user chose auto-built lineups and asked the app to follow their ESPN league's scoring when connected, or use a common default when it is not. They also specified the custom NFL roster and search behavior.

**How to apply:** Keep the no-sync path complete and label season-average estimates separately from completed-game scores. For a connected team, select from the user's own loaded roster and use that league's scoring. Do not claim a defense estimate uses custom league scoring unless it actually does.
