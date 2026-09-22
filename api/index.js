'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const ADMIN_EMAIL =
  (process.env.ADMIN_EMAIL || 'admin@earnnest.com').toLowerCase();

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || 'Admin@123';

function send(res, status, data) {
  res.statusCode = status;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,OPTIONS'
  );
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

function createToken() {
  return crypto.randomUUID();
}

function getBearer(req) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return '';
  }

  return header.slice(7).trim();
}

async function getAdmin(req) {
  const token = getBearer(req);

  if (!token) {
    return null;
  }

  try {
    const rows = await sql`
      SELECT u.*
      FROM admin_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ${token}
        AND s.expires_at > NOW()
        AND u.role = 'admin'
      LIMIT 1
    `;

    return rows[0] || null;
  } catch {
    return null;
  }
}

async function ensureAdmin() {
  await sql`
    INSERT INTO users
      (id, name, username, email, phone, password, role, coins)
    VALUES
      (
        'admin-001',
        'EarnNest Admin',
        'admin',
        ${ADMIN_EMAIL},
        '',
        ${ADMIN_PASSWORD},
        'admin',
        0
      )
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      username = EXCLUDED.username,
      role = 'admin'
  `;

  await sql`
    INSERT INTO wallets
      (user_id, balance, total_earned, total_withdrawn)
    VALUES
      ('admin-001', 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING
  `;
}

module.exports = async (req, res) => {

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );

    return res.end();
  }

  const path = req.url.split('?')[0];

  try {

    /* =========================
       HEALTH
    ========================= */

    if (
      req.method === 'GET' &&
      path === '/api/health'
    ) {
      const result = await sql`
        SELECT NOW() AS database_time
      `;

      return send(res, 200, {
        ok: true,
        success: true,
        service: 'EarnNest API',
        status: 'running',
        database: 'connected',
        databaseTime: result[0].database_time
      });
    }

    /* =========================
       DATABASE INITIALIZATION
    ========================= */

    await ensureAdmin();

    /* =========================
       LOGIN
    ========================= */

    if (
      req.method === 'POST' &&
      path === '/api/login'
    ) {

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
          message:
            'Email/username and password are required'
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
          message:
            'Invalid email/username or password'
        });
      }

      let token = null;

      if (user.role === 'admin') {

        token = createToken();

        await sql`
          INSERT INTO admin_sessions
            (user_id, token, expires_at)
          VALUES
            (
              ${user.id},
              ${token},
              NOW() + INTERVAL '24 hours'
            )
        `;
      }

      const walletRows = await sql`
        SELECT *
        FROM wallets
        WHERE user_id = ${user.id}
        LIMIT 1
      `;

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
          coins: Number(user.coins || 0),
          balance: Number(wallet?.balance || 0)
        }
      });
    }

    /* =========================
       REGISTER
    ========================= */

    if (
      req.method === 'POST' &&
      path === '/api/register'
    ) {

      const body = await readBody(req);

      const name = clean(body.name);
      const username =
        clean(body.username).toLowerCase();
      const userEmail = email(body.email);
      const phone = clean(body.phone);
      const password = String(body.password || '');
      const confirm =
        String(body.confirmPassword || '');

      if (
        !name ||
        !username ||
        !userEmail ||
        !phone ||
        !password ||
        !confirm
      ) {
        return send(res, 400, {
          success: false,
          message: 'All fields are required'
        });
      }

      if (password.length < 6) {
        return send(res, 400, {
          success: false,
          message:
            'Password must be at least 6 characters'
        });
      }

      if (password !== confirm) {
        return send(res, 400, {
          success: false,
          message: 'Passwords do not match'
        });
      }

      const existingEmail = await sql`
        SELECT id
        FROM users
        WHERE email = ${userEmail}
        LIMIT 1
      `;

      if (existingEmail.length) {
        return send(res, 409, {
          success: false,
          message: 'Email already registered'
        });
      }

      const existingUsername = await sql`
        SELECT id
        FROM users
        WHERE LOWER(username) = ${username}
        LIMIT 1
      `;

      if (existingUsername.length) {
        return send(res, 409, {
          success: false,
          message: 'Username already registered'
        });
      }

      const userId = 'user-' + crypto.randomUUID();

      await sql`
        INSERT INTO users
          (
            id,
            name,
            username,
            email,
            phone,
            password,
            role,
            coins
          )
        VALUES
          (
            ${userId},
            ${name},
            ${username},
            ${userEmail},
            ${phone},
            ${password},
            'user',
            0
          )
      `;

      await sql`
        INSERT INTO wallets
          (
            user_id,
            balance,
            total_earned,
            total_withdrawn
          )
        VALUES
          (
            ${userId},
            0,
            0,
            0
          )
      `;

      return send(res, 201, {
        success: true,
        message: 'Account created successfully',
        user: {
          id: userId,
          name,
          username,
          email: userEmail,
          phone,
          role: 'user',
          coins: 0,
          balance: 0
        }
      });
    }

    /* =========================
       ADMIN STATS
    ========================= */

    if (
      req.method === 'GET' &&
      path === '/api/admin/stats'
    ) {

      const admin = await getAdmin(req);

      if (!admin) {
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
        SELECT
          COUNT(*)::int AS total_withdrawals
        FROM withdrawals
      `;

      const pendingKyc = await sql`
        SELECT
          COUNT(*)::int AS pending_kyc
        FROM kyc_submissions
        WHERE status = 'pending'
      `;

      return send(res, 200, {
        success: true,

        stats: {
          totalUsers:
            Number(totals[0]?.total_users || 0),

          totalCoins:
            Number(totals[0]?.total_coins || 0),

          totalWithdrawals:
            Number(
              withdrawals[0]?.total_withdrawals || 0
            ),

          pendingKyc:
            Number(pendingKyc[0]?.pending_kyc || 0)
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
    }

    /* =========================
       ADMIN LOGOUT
    ========================= */

    if (
      req.method === 'POST' &&
      path === '/api/admin/logout'
    ) {

      const token = getBearer(req);

      if (token) {
        await sql`
          DELETE FROM admin_sessions
          WHERE token = ${token}
        `;
      }

      return send(res, 200, {
        success: true,
        message: 'Logged out'
      });
    }

    /* =========================
       USER PROFILE
    ========================= */

    if (
      req.method === 'GET' &&
      path === '/api/profile'
    ) {

      const token = getBearer(req);

      if (!token) {
        return send(res, 401, {
          success: false,
          message: 'Authentication required'
        });
      }

      const rows = await sql`
        SELECT *
        FROM admin_sessions
        WHERE token = ${token}
          AND expires_at > NOW()
        LIMIT 1
      `;

      if (!rows.length) {
        return send(res, 401, {
          success: false,
          message: 'Invalid or expired session'
        });
      }

      const userRows = await sql`
        SELECT *
        FROM users
        WHERE id = ${rows[0].user_id}
        LIMIT 1
      `;

      const user = userRows[0];

      if (!user) {
        return send(res, 404, {
          success: false,
          message: 'User not found'
        });
      }

      return send(res, 200, {
        success: true,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          phone: user.phone,
          role: user.role,
          coins: Number(user.coins || 0)
        }
      });
    }

    return send(res, 404, {
      success: false,
      message: 'API endpoint not found'
    });

  } catch (error) {

    console.error('EarnNest API error:', error);

    return send(res, 500, {
      success: false,
      message: 'Server error',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined
    });
  }
};


/* =========================
   READ JSON BODY
========================= */

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
        return resolve({});
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
