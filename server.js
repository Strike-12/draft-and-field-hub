/**
 * Draft & Field Hub — lightweight Express server
 * Phase 1: serves the static frontend.
 */
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Draft & Field Hub', phase: 1 });
});

app.listen(PORT, () => {
  console.log(`Draft & Field Hub listening on http://localhost:${PORT}`);
});
