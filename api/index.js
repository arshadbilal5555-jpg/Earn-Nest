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

/* =========================================================
   ENSURE ADMIN
========================================================= */

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


/* =========================================================
   EXTRA REWARD TABLE
   This table safely stores task/survey/bonus claims.
========================================================= */

async function ensureRewardTable() {

  await sql`
    CREATE TABLE IF NOT EXISTS reward_claims (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reference_key TEXT NOT NULL,
      title TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, reward_type, reference_key)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS reward_claims_user_idx
    ON reward_claims(user_id)
  `;
}


/* =========================================================
   GET USER FROM SESSION
========================================================= */

async function getSessionUser(req) {

  const token = getBearer(req);

  if (!token) {
    return null;
  }

  const rows = await sql`
    SELECT
      u.*
    FROM admin_sessions s
    JOIN users u
      ON u.id = s.user_id
    WHERE
      s.token = ${token}
      AND s.expires_at > NOW()
    LIMIT 1
  `;

  return rows[0] || null;
}


/* =========================================================
   WALLET
========================================================= */

async function getWallet(userId) {

  let rows = await sql`
    SELECT *
    FROM wallets
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  if (!rows.length) {

    await sql`
      INSERT INTO wallets
        (user_id, balance, total_earned, total_withdrawn)
      VALUES
        (${userId}, 0, 0, 0)
    `;

    rows = await sql`
      SELECT *
      FROM wallets
      WHERE user_id = ${userId}
      LIMIT 1
    `;
  }

  return rows[0];
}


/* =========================================================
   CREDIT REWARD
========================================================= */

async function creditReward({
  userId,
  type,
  referenceKey,
  title,
  amount
}) {

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Invalid reward amount');
  }

  const claimId = crypto.randomUUID();

  /*
    Insert claim first.
    UNIQUE(user_id, reward_type, reference_key)
    prevents duplicate rewards.
  */

  try {

    await sql`
      INSERT INTO reward_claims
        (
          id,
          user_id,
          reward_type,
          reference_key,
          title,
          amount
        )
      VALUES
        (
          ${claimId},
          ${userId},
          ${type},
          ${referenceKey},
          ${title},
          ${amount}
        )
    `;

  } catch (error) {

    /*
      PostgreSQL duplicate violation.
    */

    if (error.code === '23505') {
      return {
        duplicate: true
      };
    }

    throw error;
  }


  /*
    Update wallet.
  */

  await sql`
    UPDATE wallets
    SET
      balance = COALESCE(balance, 0) + ${amount},
      total_earned = COALESCE(total_earned, 0) + ${amount},
      updated_at = NOW()
    WHERE user_id = ${userId}
  `;


  /*
    Keep users.coins synchronized because
    existing admin dashboard reads this field.
  */

  await sql`
    UPDATE users
    SET
      coins = COALESCE(
        (
          SELECT balance
          FROM wallets
          WHERE user_id = ${userId}
        ),
        0
      )
    WHERE id = ${userId}
  `;


  return {
    duplicate: false,
    amount
  };
}


/* =========================================================
   MAIN API
========================================================= */

module.exports = async (req, res) => {

  if (req.method === 'OPTIONS') {

    res.statusCode = 204;

    res.setHeader(
      'Access-Control-Allow-Origin',
      '*'
    );

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

    /* =====================================================
       HEALTH
    ===================================================== */

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


    /* =====================================================
       DATABASE INITIALIZATION
    ===================================================== */

    await ensureAdmin();
    await ensureRewardTable();


    /* =====================================================
       LOGIN
    ===================================================== */

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


      /*
        Create session for BOTH admin and normal users.
      */

      const token = createToken();

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


      const wallet = await getWallet(user.id);


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

          totalEarned:
            Number(wallet?.total_earned || 0),

          totalWithdrawn:
            Number(wallet?.total_withdrawn || 0)
        }

      });
    }


    /* =====================================================
       REGISTER
    ===================================================== */

    if (
      req.method === 'POST' &&
      path === '/api/register'
    ) {

      const body = await readBody(req);

      const name = clean(body.name);

      const username =
        clean(body.username).toLowerCase();

      const userEmail =
        email(body.email);

      const phone =
        clean(body.phone);

      const password =
        String(body.password || '');

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
          message:
            'Passwords do not match'
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
          message:
            'Email already registered'
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
          message:
            'Username already registered'
        });
      }


      const userId =
        'user-' + crypto.randomUUID();


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

        message:
          'Account created successfully',

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


    /* =====================================================
       USER PROFILE
    ===================================================== */

    if (
      req.method === 'GET' &&
      path === '/api/profile'
    ) {

      const user =
        await getSessionUser(req);


      if (!user) {

        return send(res, 401, {
          success: false,
          message:
            'Invalid or expired session'
        });
      }


      const wallet =
        await getWallet(user.id);


      return send(res, 200, {

        success: true,

        user: {

          id: user.id,

          name: user.name,

          username: user.username,

          email: user.email,

          phone: user.phone,

          role: user.role,

          coins:
            Number(wallet?.balance || 0),

          balance:
            Number(wallet?.balance || 0),

          totalEarned:
            Number(wallet?.total_earned || 0),

          totalWithdrawn:
            Number(wallet?.total_withdrawn || 0)

        }

      });
    }


    /* =====================================================
       WALLET
    ===================================================== */

    if (
      req.method === 'GET' &&
      path === '/api/wallet'
    ) {

      const user =
        await getSessionUser(req);


      if (!user) {

        return send(res, 401, {
          success: false,
          message:
            'Authentication required'
        });
      }


      const wallet =
        await getWallet(user.id);


      return send(res, 200, {

        success: true,

        wallet: {

          balance:
            Number(wallet?.balance || 0),

          totalEarned:
            Number(wallet?.total_earned || 0),

          totalWithdrawn:
            Number(wallet?.total_withdrawn || 0)

        }

      });
    }


    /* =====================================================
       COMPLETE TASK
    ===================================================== */

    if (
      req.method === 'POST' &&
      path === '/api/tasks/complete'
    ) {

      const user =
        await getSessionUser(req);


      if (!user) {

        return send(res, 401, {
          success: false,
          message:
            'Authentication required'
        });
      }


      if (user.role === 'admin') {

        return send(res, 403, {
          success: false,
          message:
            'Admin cannot claim user rewards'
        });
      }


      const body =
        await readBody(req);


      const taskId =
        clean(body.taskId);

      const taskName =
        clean(body.name);

      const reward =
        Number(body.reward);


      const allowedTasks = {

        'daily-checkin': {
          name: 'Daily Check-in',
          reward: 50
        },

        'complete-profile': {
          name: 'Complete Profile',
          reward: 100
        },

        'app-visit': {
          name: 'App Visit',
          reward: 25
        },

        'weekly-activity': {
          name: 'Weekly Activity',
          reward: 250
        }

      };


      const task =
        allowedTasks[taskId];


      if (!task) {

        return send(res, 400, {
          success: false,
          message:
            'Invalid task'
        });
      }


      /*
        Never trust reward sent by browser.
      */

      const result =
        await creditReward({

          userId: user.id,

          type: 'task',

          referenceKey: taskId,

          title: task.name,

          amount: task.reward

        });


      if (result.duplicate) {

        return send(res, 409, {
          success: false,
          message:
            'This task has already been claimed.'
        });
      }


      const wallet =
        await getWallet(user.id);


      return send(res, 200, {

        success: true,

        message:
          'Task reward credited successfully',

        reward: task.reward,

        wallet: {

          balance:
            Number(wallet.balance || 0),

          totalEarned:
            Number(wallet.total_earned || 0)

        }

      });
    }


    /* =====================================================
       COMPLETE SURVEY
    ===================================================== */

    if (
      req.method === 'POST' &&
      path === '/api/surveys/complete'
    ) {

      const user =
        await getSessionUser(req);


      if (!user) {

        return send(res, 401, {
          success: false,
          message:
            'Authentication required'
        });
      }


      const body =
        await readBody(req);


      const surveyId =
        clean(body.surveyId);


      const allowedSurveys = {

        'quick-opinion': {
          name: 'Quick Opinion Survey',
          reward: 150
        },

        'shopping-survey': {
          name: 'Shopping Survey',
          reward: 300
        },

        'technology-survey': {
          name: 'Technology Survey',
          reward: 250
        }

      };


      const survey =
        allowedSurveys[surveyId];


      if (!survey) {

        return send(res, 400, {
          success: false,
          message:
            'Invalid survey'
        });
      }


      const result =
        await creditReward({

          userId: user.id,

          type: 'survey',

          referenceKey: surveyId,

          title: survey.name,

          amount: survey.reward

        });


      if (result.duplicate) {

        return send(res, 409, {
          success: false,
          message:
            'This survey has already been completed.'
        });
      }


      const wallet =
        await getWallet(user.id);


      return send(res, 200, {

        success: true,

        message:
          'Survey reward credited successfully',

        reward:
          survey.reward,

        wallet: {

          balance:
            Number(wallet.balance || 0),

          totalEarned:
            Number(wallet.total_earned || 0)

        }

      });
    }


    /* =====================================================
       DAILY BONUS
    ===================================================== */

    if (
      req.method === 'POST' &&
      path === '/api/daily-bonus'
    ) {

      const user =
        await getSessionUser(req);


      if (!user) {

        return send(res, 401, {
          success: false,
          message:
            'Authentication required'
        });
      }


      /*
        UTC date keeps the reward server-controlled.
      */

      const today =
        new Date().toISOString().slice(0, 10);


      const result =
        await creditReward({

          userId: user.id,

          type: 'daily_bonus',

          referenceKey: today,

          title: 'Daily Bonus',

          amount: 50

        });


      if (result.duplicate) {

        return send(res, 409, {
          success: false,
          message:
            'Today’s bonus has already been claimed.'
        });
      }


      const wallet =
        await getWallet(user.id);


      return send(res, 200, {

        success: true,

        message:
          'Daily bonus credited successfully',

        reward: 50,

        wallet: {

          balance:
            Number(wallet.balance || 0),

          totalEarned:
            Number(wallet.total_earned || 0)

        }

      });
    }


    /* =====================================================
       EARNINGS HISTORY
    ===================================================== */

    if (
      req.method === 'GET' &&
      path === '/api/earnings'
    ) {

      const user =
        await getSessionUser(req);


      if (!user) {

        return send(res, 401, {
          success: false,
          message:
            'Authentication required'
        });
      }


      const rows = await sql`
        SELECT
          id,
          reward_type,
          title,
          amount,
          created_at
        FROM reward_claims
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC
        LIMIT 100
      `;


      return send(res, 200, {

        success: true,

        earnings:
          rows.map(row => ({

            id: row.id,

            type: row.reward_type,

            name: row.title,

            reward:
              Number(row.amount || 0),

            date: row.created_at

          }))

      });
    }


    /* =====================================================
       ADMIN STATS
    ===================================================== */

    if (
      req.method === 'GET' &&
      path === '/api/admin/stats'
    ) {

      const admin =
        await getSessionUser(req);


      if (!admin || admin.role !== 'admin') {

        return send(res, 403, {
          success: false,
          message:
            'Admin access required'
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
            Number(
              totals[0]?.total_users || 0
            ),

          totalCoins:
            Number(
              totals[0]?.total_coins || 0
            ),

          totalWithdrawals:
            Number(
              withdrawals[0]?.total_withdrawals || 0
            ),

          pendingKyc:
            Number(
              pendingKyc[0]?.pending_kyc || 0
            )

        },

        users:
          users.map(user => ({

            id: user.id,

            name: user.name,

            username: user.username,

            email: user.email,

            phone: user.phone,

            role: user.role,

            coins:
              Number(user.coins || 0),

            createdAt:
              user.created_at

          }))

      });
    }


    /* =====================================================
       ADMIN LOGOUT / USER LOGOUT
    ===================================================== */

    if (
      req.method === 'POST' &&
      path === '/api/admin/logout'
    ) {

      const token =
        getBearer(req);


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


    /* =====================================================
       404
    ===================================================== */

    return send(res, 404, {

      success: false,

      message:
        'API endpoint not found'

    });

  } catch (error) {

    console.error(
      'EarnNest API error:',
      error
    );


    return send(res, 500, {

      success: false,

      message:
        'Server error',

      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined

    });
  }
};


/* =========================================================
   READ JSON BODY
========================================================= */

function readBody(req) {

  return new Promise((resolve, reject) => {

    let body = '';

    req.on('data', chunk => {

      body += chunk;

      if (body.length > 1024 * 1024) {

        reject(
          new Error('Request too large')
        );

        req.destroy();
      }
    });


    req.on('end', () => {

      if (!body) {

        return resolve({});

      }


      try {

        resolve(
          JSON.parse(body)
        );

      } catch {

        reject(
          new Error('Invalid JSON')
        );

      }

    });


    req.on('error', reject);

  });
}
