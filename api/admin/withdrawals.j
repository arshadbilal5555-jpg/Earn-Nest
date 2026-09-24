'use strict';

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,OPTIONS'
  );
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

async function checkAdmin(req) {
  const token = getToken(req);

  if (!token) {
    return null;
  }

  const sessions = await sql`
    SELECT user_id
    FROM admin_sessions
    WHERE token = ${token}
      AND expires_at > NOW()
    LIMIT 1
  `;

  if (!sessions.length) {
    return null;
  }

  const userId = String(sessions[0].user_id);

  const users = await sql`
    SELECT
      id,
      name,
      username,
      email,
      role
    FROM users
    WHERE id::text = ${userId}
    LIMIT 1
  `;

  if (!users.length || users[0].role !== 'admin') {
    return null;
  }

  return users[0];
}

module.exports = async function handler(req, res) {

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,OPTIONS'
    );
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

    const admin = await checkAdmin(req);

    if (!admin) {
      return send(res, 403, {
        success: false,
        message: 'Admin access required'
      });
    }

    const rows = await sql`
      SELECT
        w.id,
        w.user_id,
        w.amount,
        w.payment_method,
        w.account_number,
        w.status,
        w.created_at,
        u.name AS user_name,
        u.username AS user_username,
        u.email AS user_email
      FROM withdrawals w
      LEFT JOIN users u
        ON u.id::text = w.user_id::text
      ORDER BY w.created_at DESC
    `;

    const withdrawals = rows.map(function(w) {
      return {
        id: String(w.id),
        user_id: String(w.user_id || ''),
        name: w.user_name || '',
        username: w.user_username || '',
        email: w.user_email || '',
        amount: Number(w.amount || 0),
        payment_method: w.payment_method || '',
        account_number: w.account_number || '',
        status: w.status || 'pending',
        created_at: w.created_at || null
      };
    });

    return send(res, 200, {
      success: true,
      withdrawals: withdrawals
    });

  } catch (error) {

    console.error('Admin withdrawals API error:', error);

    return send(res, 500, {
      success: false,
      message: error.message || 'Server error'
    });
  }
};
