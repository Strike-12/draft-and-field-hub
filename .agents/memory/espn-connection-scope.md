---
name: ESPN connection scope
description: The accepted authentication boundary for ESPN Fantasy league sync.
---

Support ESPN public leagues through a share link, explicit roster-access consent, and a choice of the user's team. Do not ask users for ESPN passwords, SWID, or espn_s2 cookies. Private leagues remain unsupported unless ESPN offers a documented authorization flow or the user chooses another provider.

**Why:** The user wants a simple connection flow and chose the public share-link option after learning ESPN's private league API relies on session cookies.

**How to apply:** Keep public league data read-only and page-session-only; state the private-league limitation instead of implying that an ESPN sign-in redirect is available.
