/**
 * Draft & Field Hub — Express server
 * Phase 1: static frontend + health check
 * Phase 2: ESPN Fantasy sync (POST /api/sync/espn)
 * Phase 3: live top performers feed (GET /api/performers/:sport)
 * Phase 4: quick compare (GET /api/players/:sport, POST /api/compare)
 * Phase 5: AI start/sit assistant (POST /api/assistant/start-sit)
 * Phase 6: Build My Team (GET /api/projections/:sport, POST /api/sync/espn/auto)
 */
const express = require('express');
const path = require('path');
const cors = require('cors');
const { clerkMiddleware } = require('@clerk/express');
const { publishableKeyFromHost } = require('@clerk/shared/keys');
const {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost
} = require('./server/middlewares/clerkProxyMiddleware');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(clerkMiddleware(req => ({
  publishableKey: publishableKeyFromHost(
    getClerkProxyHost(req) ?? '',
    process.env.CLERK_PUBLISHABLE_KEY
  )
})));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/auth/config', (req, res) => {
  const key = process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || '';
  res.set('Cache-Control', 'no-store');
  res.json({
    publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? '', key),
    proxyUrl: process.env.VITE_CLERK_PROXY_URL || process.env.CLERK_PROXY_URL || ''
  });
});

app.get(['/sign-in', '/sign-in/*', '/sign-up', '/sign-up/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Draft & Field Hub', phase: 6 });
});

app.use('/api', require('./routes/espn'));
app.use('/api', require('./routes/feeds'));
app.use('/api', require('./routes/compare'));
app.use('/api', require('./routes/assistant'));
app.use('/api', require('./routes/user-teams'));
app.use('/api', require('./routes/buildteam'));
app.use('/api', require('./routes/weekly'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Draft & Field Hub listening on http://localhost:${PORT}`);
});
