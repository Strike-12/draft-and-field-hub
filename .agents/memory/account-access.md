---
name: Account access
description: Authentication setup and guest-access behavior for Draft & Field Hub.
---

Use Replit-managed Clerk for account creation and sign-in. Keep the public player, stats, and team-building tools accessible to signed-out visitors. Authentication alone does not save synced ESPN rosters or built teams; those remain page-session-only until persistence is implemented.

**Why:** The user requested login and account creation, while the app's audience includes people who want to build teams and check stats without connecting an ESPN league.

**How to apply:** Do not gate public sports tools on authentication by default. If adding saved account data, associate it with the verified Clerk user ID and persist it separately from the temporary page session.
