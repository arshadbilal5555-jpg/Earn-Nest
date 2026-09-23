'use strict';

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );
  res.end(JSON.stringify(data));
}

function getToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
    return res.end();
  }

  if (req.method !== 'GET') {
    return send(res, 405, {
      success: false,
      message: 'Method not allowed. Use GET.'
    });
  }

  try {
    const token = getToken(req);

    if (!token) {
      return send(res, 401, {
        success: false,
        message: 'Authentication required'
      });
    }

    const rows = await sql`
      SELECT
        u.id,
        u.name,
        u.username,
        u.email,
        u.phone,
        u.role,
        COALESCE(w.balance, 0) AS balance,
        COALESCE(w.total_earned, 0) AS total_earned,
        COALESCE(w.total_withdrawn, 0) AS total_withdrawn
      FROM admin_sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN wallets w ON w.user_id = u.id
      WHERE s.token = ${token}
        AND s.expires_at > NOW()
      LIMIT 1
    `;

    if (!rows.length) {
      return send(res, 401, {
        success: false,
        message: 'Invalid or expired session'
      });
    }

    const u = rows[0];

    return send(res, 200, {
      success: true,
      user: {
        id: u.id,
        name: u.name,
        username: u.username,
        email: u.email,
        phone: u.phone,
        role: u.role,
        coins: Number(u.balance || 0),
        balance: Number(u.balance || 0),
        totalEarned: Number(u.total_earned || 0),
        totalWithdrawn: Number(u.total_withdrawn || 0)
      }
    });

  } catch (error) {
    console.error('Profile API error:', error);

    return send(res, 500, {
      success: false,
      message: 'Server error'
    });
  }
};
