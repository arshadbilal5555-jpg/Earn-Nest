'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

/* =========================================================
   BASIC HELPERS
========================================================= */

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

  return res.end(JSON.stringify(data));
}

function getToken(req) {
  const auth = req.headers.authorization || '';

  if (auth.startsWith('Bearer ')) {
    return auth.substring(7).trim();
  }

  return '';
}

async function readBody(req) {
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
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', reject);
  });
}

function makeId() {
  return crypto.randomUUID();
}

function makeToken() {
  return crypto.randomBytes(48).toString('hex');
}

function makeReferralCode() {
  return crypto.randomBytes(5).toString('hex').toUpperCase();
}

/* =========================================================
   USER AUTH
========================================================= */

async function getUserFromToken(req) {
  const token = getToken(req);

  if (!token) {
    return null;
  }

  const rows = await sql`
    SELECT
      u.id,
      u.name,
      u.username,
      u.email,
      u.phone,
      u.role,
      u.coins,
      u.created_at,
      u.referral_code,
      u.referred_by
    FROM admin_sessions s
    JOIN users u
      ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
    LIMIT 1
  `;

  return rows[0] || null;
}

/* =========================================================
   WALLET
========================================================= */

async function getWallet(userId) {
  const uid = String(userId);

  const rows = await sql`
    SELECT
      id,
      user_id,
      balance,
      total_earned,
      total_withdrawn,
      created_at,
      updated_at
    FROM wallets
    WHERE user_id = ${uid}
    LIMIT 1
  `;

  if (rows.length) {
    return rows[0];
  }

  const created = await sql`
    INSERT INTO wallets
      (
        user_id,
        balance,
        total_earned,
        total_withdrawn
      )
    VALUES
      (
        ${uid},
        0,
        0,
        0
      )
    RETURNING
      id,
      user_id,
      balance,
      total_earned,
      total_withdrawn,
      created_at,
      updated_at
  `;

  return created[0];
}

/* =========================================================
   LOGIN
========================================================= */

async function handleLogin(body, res) {
  const email = String(body.email || '').trim().toLowerCase();
  const login = String(body.login || '').trim().toLowerCase();
  const password = String(body.password || '');

  const identifier = email || login;

  if (!identifier || !password) {
    return send(res, 400, {
      success: false,
      message: 'Email/username and password are required.'
    });
  }

  try {
    const users = await sql`
      SELECT
        id,
        name,
        username,
        email,
        phone,
        password,
        role,
        coins,
        created_at,
        referral_code,
        referred_by
      FROM users
      WHERE LOWER(email) = ${identifier}
         OR LOWER(username) = ${identifier}
      LIMIT 1
    `;

    if (!users.length) {
      return send(res, 401, {
        success: false,
        message: 'Invalid email/username or password.'
      });
    }

    const dbUser = users[0];

    /*
      EarnNest database currently has a column named "password".
      Do NOT use password_hash here.
    */
    if (String(dbUser.password || '') !== password) {
      return send(res, 401, {
        success: false,
        message: 'Invalid email/username or password.'
      });
    }

    const token = makeToken();

    /*
      IMPORTANT:
      admin_sessions.id is BIGINT auto-generated.
      Therefore we DO NOT insert an id here.

      admin_sessions.user_id is TEXT.
      users.id is TEXT / UUID.
    */
    await sql`
      INSERT INTO admin_sessions
        (
          user_id,
          token,
          expires_at,
          created_at
        )
      VALUES
        (
          ${String(dbUser.id)},
          ${token},
          NOW() + INTERVAL '30 days',
          NOW()
        )
    `;

    const safeUser = {
      id: dbUser.id,
      name: dbUser.name,
      username: dbUser.username,
      email: dbUser.email,
      phone: dbUser.phone,
      role: dbUser.role,
      coins: Number(dbUser.coins || 0),
      created_at: dbUser.created_at,
      referral_code: dbUser.referral_code,
      referred_by: dbUser.referred_by
    };

    return send(res, 200, {
      success: true,
      message: 'Login successful.',
      token,
      user: safeUser
    });

  } catch (error) {
    console.error('LOGIN ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Login database error.',
      error: error.message || 'Unknown database error',
      code: error.code || null,
      detail: error.detail || null
    });
  }
}

/* =========================================================
   REGISTER
========================================================= */

async function handleRegister(body, res) {
  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');
  const confirmPassword = String(
    body.confirmPassword ||
    body.confirm_password ||
    ''
  );

  const referralCode = String(
    body.referralCode ||
    body.referral_code ||
    ''
  ).trim();

  if (!name || !username || !email || !password) {
    return send(res, 400, {
      success: false,
      message: 'Name, username, email and password are required.'
    });
  }

  if (password.length < 6) {
    return send(res, 400, {
      success: false,
      message: 'Password must be at least 6 characters.'
    });
  }

  if (confirmPassword && password !== confirmPassword) {
    return send(res, 400, {
      success: false,
      message: 'Passwords do not match.'
    });
  }

  try {
    const existing = await sql`
      SELECT id, email, username
      FROM users
      WHERE LOWER(email) = ${email}
         OR LOWER(username) = ${username.toLowerCase()}
      LIMIT 1
    `;

    if (existing.length) {
      if (
        String(existing[0].email || '').toLowerCase() === email
      ) {
        return send(res, 409, {
          success: false,
          message: 'Email already registered.'
        });
      }

      return send(res, 409, {
        success: false,
        message: 'Username already taken.'
      });
    }

    let referredBy = null;

    if (referralCode) {
      const referrer = await sql`
        SELECT id
        FROM users
        WHERE referral_code = ${referralCode}
        LIMIT 1
      `;

      if (referrer.length) {
        referredBy = String(referrer[0].id);
      }
    }

    const userId = makeId();
    const newReferralCode = makeReferralCode();

    const created = await sql`
      INSERT INTO users
        (
          id,
          name,
          username,
          email,
          phone,
          password,
          role,
          coins,
          created_at,
          referral_code,
          referred_by
        )
      VALUES
        (
          ${userId},
          ${name},
          ${username},
          ${email},
          ${phone},
          ${password},
          'user',
          0,
          NOW(),
          ${newReferralCode},
          ${referredBy}
        )
      RETURNING
        id,
        name,
        username,
        email,
        phone,
        role,
        coins,
        created_at,
        referral_code,
        referred_by
    `;

    /*
      Wallet id is BIGINT auto-generated.
      We only provide user_id.
    */
    await sql`
      INSERT INTO wallets
        (
          user_id,
          balance,
          total_earned,
          total_withdrawn,
          created_at,
          updated_at
        )
      VALUES
        (
          ${userId},
          0,
          0,
          0,
          NOW(),
          NOW()
        )
    `;

    const token = makeToken();

    await sql`
      INSERT INTO admin_sessions
        (
          user_id,
          token,
          expires_at,
          created_at
        )
      VALUES
        (
          ${userId},
          ${token},
          NOW() + INTERVAL '30 days',
          NOW()
        )
    `;

    return send(res, 201, {
      success: true,
      message: 'Account created successfully.',
      token,
      user: created[0]
    });

  } catch (error) {
    console.error('REGISTER ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Unable to create account.',
      error: error.message || 'Database error',
      code: error.code || null,
      detail: error.detail || null
    });
  }
}

/* =========================================================
   DASHBOARD
========================================================= */

async function handleDashboard(req, res) {
  try {
    const user = await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message: 'Authentication required.'
      });
    }

    const wallet = await getWallet(String(user.id));

    return send(res, 200, {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        referral_code: user.referral_code
      },
      wallet: {
        balance: Number(wallet.balance || 0),
        total_earned: Number(wallet.total_earned || 0),
        total_withdrawn: Number(wallet.total_withdrawn || 0)
      }
    });

  } catch (error) {
    console.error('DASHBOARD ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Unable to load dashboard.',
      error: error.message
    });
  }
}

/* =========================================================
   WALLET
========================================================= */

async function handleWallet(req, res) {
  try {
    const user = await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message: 'Authentication required.'
      });
    }

    const wallet = await getWallet(String(user.id));

    return send(res, 200, {
      success: true,
      wallet
    });

  } catch (error) {
    console.error('WALLET ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Unable to load wallet.',
      error: error.message
    });
  }
}

/* =========================================================
   CLAIM REWARD
========================================================= */

async function handleClaimReward(body, req, res) {
  try {
    const user = await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message: 'Please login first.'
      });
    }

    const rewardType = String(
      body.rewardType ||
      body.reward_type ||
      'task'
    ).trim();

    const referenceKey = String(
      body.rewardId ||
      body.reward_id ||
      body.referenceKey ||
      body.reference_key ||
      ''
    ).trim();

    const title = String(
      body.title ||
      body.rewardTitle ||
      `${rewardType} reward`
    ).trim();

    let amount = Number(
      body.amount ||
      body.reward ||
      0
    );

    /*
      Known demo rewards.
      If frontend sends an amount, that amount is used.
    */
    if (!amount) {
      if (rewardType === 'task') {
        amount = 10;
      } else if (rewardType === 'survey') {
        amount = 25;
      } else if (rewardType === 'daily_bonus') {
        amount = 50;
      }
    }

    if (!referenceKey) {
      return send(res, 400, {
        success: false,
        message: 'Reward ID is required.'
      });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return send(res, 400, {
        success: false,
        message: 'Invalid reward amount.'
      });
    }

    /*
      reward_claims uses reference_key, NOT reward_id.
    */
    const alreadyClaimed = await sql`
      SELECT id
      FROM reward_claims
      WHERE user_id = ${String(user.id)}
        AND reward_type = ${rewardType}
        AND reference_key = ${referenceKey}
      LIMIT 1
    `;

    if (alreadyClaimed.length) {
      return send(res, 409, {
        success: false,
        message: 'This reward has already been claimed.'
      });
    }

    const wallet = await getWallet(String(user.id));

    const oldBalance = Number(wallet.balance || 0);
    const oldEarned = Number(wallet.total_earned || 0);

    const newBalance = oldBalance + amount;
    const newEarned = oldEarned + amount;

    /*
      Update wallet.
      wallet.id is BIGINT, so we use it only as the existing id.
    */
    await sql`
      UPDATE wallets
      SET
        balance = ${newBalance},
        total_earned = ${newEarned},
        updated_at = NOW()
      WHERE user_id = ${String(user.id)}
    `;

    /*
      Keep users.coins synchronized with wallet balance.
    */
    await sql`
      UPDATE users
      SET coins = ${newBalance}
      WHERE id = ${String(user.id)}
    `;

    /*
      reward_claims.id is TEXT, so UUID is correct.
      reward_claims.user_id is also TEXT.
    */
    const claimId = makeId();

    await sql`
      INSERT INTO reward_claims
        (
          id,
          user_id,
          reward_type,
          reference_key,
          title,
          amount,
          created_at
        )
      VALUES
        (
          ${claimId},
          ${String(user.id)},
          ${rewardType},
          ${referenceKey},
          ${title},
          ${amount},
          NOW()
        )
    `;

    return send(res, 200, {
      success: true,
      message: 'Reward added successfully.',
      reward: {
        type: rewardType,
        reference_key: referenceKey,
        title,
        amount
      },
      wallet: {
        balance: newBalance,
        total_earned: newEarned,
        total_withdrawn: Number(wallet.total_withdrawn || 0)
      }
    });

  } catch (error) {
    console.error('REWARD CLAIM ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Unable to process reward.',
      error: error.message || 'Database error',
      code: error.code || null,
      detail: error.detail || null
    });
  }
}

/* =========================================================
   LOGOUT
========================================================= */

async function handleLogout(req, res) {
  try {
    const token = getToken(req);

    if (token) {
      await sql`
        DELETE FROM admin_sessions
        WHERE token = ${token}
      `;
    }

    return send(res, 200, {
      success: true,
      message: 'Logged out successfully.'
    });

  } catch (error) {
    console.error('LOGOUT ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Logout failed.',
      error: error.message
    });
  }
}

/* =========================================================
   DAILY BONUS
========================================================= */

async function handleDailyBonus(req, res) {
  try {
    const user = await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message: 'Please login first.'
      });
    }

    const rewardType = 'daily_bonus';
    const referenceKey =
      'daily_' + new Date().toISOString().slice(0, 10);

    const already = await sql`
      SELECT id
      FROM reward_claims
      WHERE user_id = ${String(user.id)}
        AND reward_type = ${rewardType}
        AND reference_key = ${referenceKey}
      LIMIT 1
    `;

    if (already.length) {
      return send(res, 409, {
        success: false,
        message: 'Daily bonus already claimed today.'
      });
    }

    return handleClaimReward(
      {
        rewardType: 'daily_bonus',
        rewardId: referenceKey,
        title: 'Daily Bonus',
        amount: 50
      },
      req,
      res
    );

  } catch (error) {
    console.error('DAILY BONUS ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Unable to claim daily bonus.',
      error: error.message
    });
  }
}

/* =========================================================
   ADMIN STATS
========================================================= */

async function handleAdminStats(req, res) {
  try {
    const user = await getUserFromToken(req);

    if (!user || user.role !== 'admin') {
      return send(res, 403, {
        success: false,
        message: 'Admin access required.'
      });
    }

    const users = await sql`
      SELECT COUNT(*)::int AS count
      FROM users
    `;

    const coins = await sql`
      SELECT COALESCE(SUM(balance), 0) AS total
      FROM wallets
    `;

    const withdrawals = await sql`
      SELECT COUNT(*)::int AS count
      FROM reward_claims
      WHERE reward_type = 'withdrawal'
    `;

    return send(res, 200, {
      success: true,
      stats: {
        totalUsers: Number(users[0]?.count || 0),
        totalCoins: Number(coins[0]?.total || 0),
        totalWithdrawals: Number(
          withdrawals[0]?.count || 0
        ),
        pendingKyc: 0
      }
    });

  } catch (error) {
    console.error('ADMIN STATS ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Unable to load admin statistics.',
      error: error.message
    });
  }
}

/* =========================================================
   MAIN API ROUTER
========================================================= */

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return send(res, 200, {
      success: true
    });
  }

  try {
    const body =
      req.method === 'POST'
        ? await readBody(req)
        : {};

    const action = String(
      body.action ||
      req.query?.action ||
      ''
    ).trim().toLowerCase();

    /*
      Health check
    */
    if (req.method === 'GET' && !action) {
      return send(res, 200, {
        success: true,
        service: 'EarnNest API',
        status: 'running'
      });
    }

    /* LOGIN */
    if (
      action === 'login' ||
      action === 'signin'
    ) {
      return handleLogin(body, res);
    }

    /* REGISTER */
    if (
      action === 'register' ||
      action === 'signup' ||
      action === 'create_account'
    ) {
      return handleRegister(body, res);
    }

    /* DASHBOARD */
    if (
      action === 'dashboard' ||
      action === 'get_dashboard' ||
      action === 'me'
    ) {
      return handleDashboard(req, res);
    }

    /* WALLET */
    if (
      action === 'wallet' ||
      action === 'get_wallet'
    ) {
      return handleWallet(req, res);
    }

    /* CLAIM REWARD */
    if (
      action === 'claim_reward' ||
      action === 'complete_task' ||
      action === 'complete_survey'
    ) {
      return handleClaimReward(body, req, res);
    }

    /* DAILY BONUS */
    if (
      action === 'daily_bonus' ||
      action === 'claim_daily_bonus'
    ) {
      return handleDailyBonus(req, res);
    }

    /* LOGOUT */
    if (action === 'logout') {
      return handleLogout(req, res);
    }

    /* ADMIN STATS */
    if (
      action === 'admin_stats' ||
      action === 'get_admin_stats'
    ) {
      return handleAdminStats(req, res);
    }

    return send(res, 400, {
      success: false,
      message: 'Unknown API action.',
      action
    });

  } catch (error) {
    console.error('API ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Server error.',
      error: error.message || 'Unknown error',
      code: error.code || null,
      detail: error.detail || null
    });
  }
};
