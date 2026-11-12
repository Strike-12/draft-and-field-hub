---
name: Start/sit assistant behavior
description: Fallback behavior and transparency for lineup advice when no language model is configured.
---

When a generative model is not configured, provide transparent, stats-based start/sit recommendations from the synced roster rather than generic canned advice. Compare season fantasy points per game when available, keep completed-game scores separate from projections, and disclose that matchup-specific advice is unavailable.

**Why:** The user reported that the assistant did not work; the project had no model provider configured and its fallback ignored both the question and player scoring.

**How to apply:** Keep the stats-based path usable without API credentials. Only describe responses as model-generated when an actual language-model service answered.
