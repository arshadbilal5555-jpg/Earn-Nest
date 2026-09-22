'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  res.end(JSON.stringify(data));
}

function clean(value) {
  return String(value ?? '').trim();
}

function email(value) {
  return clean(value).toLowerCase();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
      }
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

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
    return res.end();
  }

  if (req.method !== 'POST') {
    return send(res, 405, {
      success: false,
      message: 'Method not allowed. Use POST.'
    });
  }

  try {
    const body = await readBody(req);

    const login = email(
      body.login ||
      body.email ||
      body.username
    );

    const password = String(body.password || '');

    if (!login || !password) {
      return send(res, 400, {
        success: false,
        message: 'Email/username and password are required'
      });
    }

    let rows = await sql`
      SELECT *
      FROM users
      WHERE email = ${login}
      LIMIT 1
    `;

    if (!rows.length) {
      rows = await sql`
        SELECT *
        FROM users
        WHERE LOWER(username) = ${login}
        LIMIT 1
      `;
    }

    const user = rows[0];

    if (!user || user.password !== password) {
      return send(res, 401, {
        success: false,
        message: 'Invalid email/username or password'
      });
    }

    const token = crypto.randomUUID();

    await sql`
      INSERT INTO admin_sessions
        (user_id, token, expires_at)
      VALUES
        (
          ${user.id},
          ${token},
          NOW() + INTERVAL '30 days'
        )
    `;

    let walletRows = await sql`
      SELECT *
      FROM wallets
      WHERE user_id = ${user.id}
      LIMIT 1
    `;

    if (!walletRows.length) {
      await sql`
        INSERT INTO wallets
          (user_id, balance, total_earned, total_withdrawn)
        VALUES
          (${user.id}, 0, 0, 0)
      `;

      walletRows = await sql`
        SELECT *
        FROM wallets
        WHERE user_id = ${user.id}
        LIMIT 1
      `;
    }

    const wallet = walletRows[0];

    return send(res, 200, {
      success: true,
      message: 'Login successful',
      token,

      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        coins: Number(wallet?.balance || 0),
        balance: Number(wallet?.balance || 0),
        totalEarned: Number(wallet?.total_earned || 0),
        totalWithdrawn: Number(wallet?.total_withdrawn || 0)
      }
    });

  } catch (error) {
    console.error('Login API error:', error);

    return send(res, 500, {
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
