'use strict';

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST,OPTIONS'
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
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
    SELECT id, name, username, email, role
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
      'POST,OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
    return res.end();
  }

  if (req.method !== 'POST') {
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

    const body = await readBody(req);

    const id = String(body.id || '').trim();

    if (!id) {
      return send(res, 400, {
        success: false,
        message: 'Withdrawal ID is required'
      });
    }

    const rows = await sql`
      SELECT
        id,
        user_id,
        amount,
        status
      FROM withdrawals
      WHERE id::text = ${id}
      LIMIT 1
    `;

    if (!rows.length) {
      return send(res, 404, {
        success: false,
        message: 'Withdrawal not found'
      });
    }

    const withdrawal = rows[0];

    if (withdrawal.status !== 'pending') {
      return send(res, 400, {
        success: false,
        message: 'This withdrawal has already been processed'
      });
    }

    await sql`
      UPDATE withdrawals
      SET status = 'approved'
      WHERE id::text = ${id}
    `;

    return send(res, 200, {
      success: true,
      message: 'Withdrawal approved successfully'
    });

  } catch (error) {

    console.error('Approve withdrawal error:', error);

    return send(res, 500, {
      success: false,
      message: error.message || 'Server error'
    });
  }
};
