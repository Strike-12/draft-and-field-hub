---
name: Account access
description: Authentication setup and guest-access behavior for Draft & Field Hub.
---

Use Replit-managed Clerk for account creation and sign-in. Keep public player, stats, and team-building tools accessible to signed-out visitors. Save signed-in users' ESPN, custom, and generated teams under their verified Clerk user ID; signed-out teams stay in that browser's local storage.

A signed-in user's successful ESPN league connection must persist with the account and be restored on later visits; do not ask them to paste the same public link every time.

**Why:** The user requested login and account creation, and said an ESPN connection should stay with the account so users do not have to reconnect every visit.

**How to apply:** Do not gate public sports tools on authentication by default. Never accept a client-supplied account ID for private team storage; derive ownership from the Clerk session. Keep ESPN league and selected-team details with the saved team, and restore them when the account loads.
