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
        w.balance,
        w.total_earned,
        w.total_withdrawn
      FROM admin_sessions s
      JOIN wallets w ON w.user_id = s.user_id
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

    const w = rows[0];

    const pendingRows = await sql`
      SELECT COALESCE(SUM(amount), 0)::int AS pending
      FROM withdrawal_requests
      WHERE user_id = (
        SELECT user_id
        FROM admin_sessions
        WHERE token = ${token}
        LIMIT 1
      )
      AND status = 'pending'
    `;

    return send(res, 200, {
      success: true,
      wallet: {
        balance: Number(w.balance || 0),
        totalEarned: Number(w.total_earned || 0),
        totalWithdrawn: Number(w.total_withdrawn || 0),
        pendingWithdrawal: Number(pendingRows[0]?.pending || 0)
      }
    });

  } catch (error) {
    console.error('Wallet API error:', error);

    return send(res, 500, {
      success: false,
      message: 'Server error'
    });
  }
};
