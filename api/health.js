'use strict';

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');

    res.end(JSON.stringify({
      ok: false,
      success: false,
      message: 'Method not allowed.'
    }));

    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');

  res.end(JSON.stringify({
    ok: true,
    success: true,
    service: 'EarnNest API',
    status: 'running'
  }));
};
