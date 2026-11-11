/**
 * Draft & Field Hub — Express server
 * Phase 1: static frontend + health check
 * Phase 2: ESPN Fantasy sync (POST /api/sync/espn)
 * Phase 3: live top performers feed (GET /api/performers/:sport)
 */
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Draft & Field Hub', phase: 3 });
});

app.use('/api', require('./routes/espn'));
app.use('/api', require('./routes/feeds'));

app.listen(PORT, () => {
  console.log(`Draft & Field Hub listening on http://localhost:${PORT}`);
});
