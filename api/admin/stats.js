'use strict';

const crypto = require('crypto');
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

  if (!auth.startsWith('Bearer ')) {
    return '';
  }

  return auth.slice(7).trim();
}

module.exports = async function handler(req, res) {

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
      message: 'Method not allowed'
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

    const session = await sql`
      SELECT u.id, u.role
      FROM admin_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ${token}
        AND s.expires_at > NOW()
      LIMIT 1
    `;

    if (!session.length || session[0].role !== 'admin') {
      return send(res, 403, {
        success: false,
        message: 'Admin access required'
      });
    }

    const users = await sql`
      SELECT
        id,
        name,
        username,
        email,
        phone,
        role,
        coins,
        created_at
      FROM users
      WHERE role != 'admin'
      ORDER BY created_at DESC
    `;

    const totals = await sql`
      SELECT
        COUNT(*)::int AS total_users,
        COALESCE(SUM(coins), 0)::int AS total_coins
      FROM users
      WHERE role != 'admin'
    `;

    const withdrawals = await sql`
      SELECT COUNT(*)::int AS total_withdrawals
      FROM withdrawal_requests
    `;

    const pendingWithdrawals = await sql`
      SELECT COUNT(*)::int AS pending_withdrawals
      FROM withdrawal_requests
      WHERE status = 'pending'
    `;

    let pendingKyc = 0;

    try {
      const kyc = await sql`
        SELECT COUNT(*)::int AS pending_kyc
        FROM kyc_submissions
        WHERE status = 'pending'
      `;

      pendingKyc = Number(kyc[0]?.pending_kyc || 0);
    } catch {
      pendingKyc = 0;
    }

    return send(res, 200, {
      success: true,

      stats: {
        totalUsers: Number(totals[0]?.total_users || 0),
        totalCoins: Number(totals[0]?.total_coins || 0),
        totalWithdrawals: Number(
          withdrawals[0]?.total_withdrawals || 0
        ),
        pendingWithdrawals: Number(
          pendingWithdrawals[0]?.pending_withdrawals || 0
        ),
        pendingKyc
      },

      users: users.map(user => ({
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        coins: Number(user.coins || 0),
        createdAt: user.created_at
      }))
    });

  } catch (error) {
    console.error('Admin stats error:', error);

    return send(res, 500, {
      success: false,
      message: 'Unable to load admin dashboard'
    });
  }
};
