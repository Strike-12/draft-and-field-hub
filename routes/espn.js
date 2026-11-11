/**
 * The former cookie-pasting sync is intentionally disabled.
 * Public ESPN league share links are handled by routes/buildteam.js.
 */
const express = require('express');
const router = express.Router();

router.post('/sync/espn', (req, res) => {
  res.status(410).json({
    error: 'Cookie-based ESPN sync is disabled. Use the public ESPN league share-link flow instead.'
  });
});

module.exports = router;
