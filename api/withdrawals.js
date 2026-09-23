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

    const sessions = await sql`
      SELECT user_id
      FROM admin_sessions
      WHERE token = ${token}
        AND expires_at > NOW()
      LIMIT 1
    `;

    if (!sessions.length) {
      return send(res, 401, {
        success: false,
        message: 'Invalid or expired session'
      });
    }

    const userId = String(sessions[0].user_id);

    const rows = await sql`
      SELECT
        id,
        amount,
        payment_method,
        account_number,
        status,
        created_at
      FROM withdrawals
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 100
    `;

    return send(res, 200, {
      success: true,
      withdrawals: rows.map(row => ({
        id: String(row.id),
        amount: Number(row.amount || 0),
        paymentMethod: row.payment_method,
        accountNumber: row.account_number,
        status: row.status,
        createdAt: row.created_at
      }))
    });

  } catch (error) {
    console.error('Withdrawal history error:', error);

    return send(res, 500, {
      success: false,
      message: error.message || 'Unable to load withdrawal history'
    });
  }
};
