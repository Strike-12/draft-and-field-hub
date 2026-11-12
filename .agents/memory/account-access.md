---
name: Account access
description: Authentication setup and guest-access behavior for Draft & Field Hub.
---

Use Replit-managed Clerk for account creation and sign-in. Keep public player, stats, and team-building tools accessible to signed-out visitors. Save signed-in users' ESPN, custom, and generated teams under their verified Clerk user ID; signed-out teams stay in that browser's local storage.

**Why:** The user requested login and account creation, while the app's audience includes people who want to build teams and check stats without connecting an ESPN league.

**How to apply:** Do not gate public sports tools on authentication by default. Never accept a client-supplied account ID for private team storage; derive ownership from the Clerk session.
