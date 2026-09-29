'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
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
  const auth = req.headers?.authorization || '';

  if (!auth) return null;

  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.substring(7).trim();
  }

  return auth.trim();
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
        reject(new Error('Invalid JSON request'));
      }
    });

    req.on('error', reject);
  });
}

/* =========================================================
   USER AUTH
========================================================= */

async function getUserFromToken(token) {
  if (!token) return null;

  const rows = await sql`
    SELECT u.*
    FROM admin_sessions s
    INNER JOIN users u
      ON u.id::text = s.user_id::text
    WHERE s.token = ${token}
      AND (
        s.expires_at IS NULL
        OR s.expires_at > NOW()
      )
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
    WHERE user_id::text = ${String(userId)}
    LIMIT 1
  `;

  if (rows.length > 0) {
    return rows[0];
  }

  const walletId = crypto.randomUUID();

  try {
    await sql`
      INSERT INTO wallets (
        id,
        user_id,
        balance,
        total_earned,
        total_withdrawn
      )
      VALUES (
        ${walletId},
        ${String(userId)},
        0,
        0,
        0
      )
    `;
  } catch (error) {
    /*
      If an older database does not have total_withdrawn,
      create the wallet with the basic fields.
    */
    if (
      String(error.message || '')
        .toLowerCase()
        .includes('total_withdrawn')
    ) {
      await sql`
        INSERT INTO wallets (
          id,
          user_id,
          balance,
          total_earned
        )
        VALUES (
          ${walletId},
          ${String(userId)},
          0,
          0
        )
      `;
    } else {
      throw error;
    }
  }

  rows = await sql`
    SELECT *
    FROM wallets
    WHERE user_id::text = ${String(userId)}
    LIMIT 1
  `;

  return rows[0];
}

/* =========================================================
   REWARD TABLE
========================================================= */

async function ensureRewardTable() {
  /*
    First make sure the table exists.
  */
  await sql`
    CREATE TABLE IF NOT EXISTS reward_claims (
      id UUID PRIMARY KEY,
      user_id TEXT,
      reward_type TEXT,
      reward_id TEXT,
      coins INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  /*
    Old versions of the table may be missing columns.
    Add them one by one.
  */

  await sql`
    ALTER TABLE reward_claims
    ADD COLUMN IF NOT EXISTS user_id TEXT
  `;

  await sql`
    ALTER TABLE reward_claims
    ADD COLUMN IF NOT EXISTS reward_type TEXT
  `;

  await sql`
    ALTER TABLE reward_claims
    ADD COLUMN IF NOT EXISTS reward_id TEXT
  `;

  await sql`
    ALTER TABLE reward_claims
    ADD COLUMN IF NOT EXISTS coins INTEGER
  `;

  await sql`
    ALTER TABLE reward_claims
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `;

  /*
    Old rows may have NULL values.
    Give them safe values so the new system can work.
  */

  await sql`
    UPDATE reward_claims
    SET reward_type = 'legacy'
    WHERE reward_type IS NULL
  `;

  await sql`
    UPDATE reward_claims
    SET reward_id = 'legacy-' || id::text
    WHERE reward_id IS NULL
  `;

  await sql`
    UPDATE reward_claims
    SET coins = 0
    WHERE coins IS NULL
  `;

  await sql`
    UPDATE reward_claims
    SET created_at = NOW()
    WHERE created_at IS NULL
  `;
}

/* =========================================================
   TASKS
========================================================= */

const TASKS = {
  task1: {
    title: 'Daily Check-in',
    reward: 50,
    period: 'daily'
  },

  task2: {
    title: 'Follow Social Page',
    reward: 100,
    period: 'once'
  },

  task3: {
    title: 'Read EarnNest Guide',
    reward: 75,
    period: 'once'
  },

  task4: {
    title: 'Complete Profile',
    reward: 100,
    period: 'once'
  },

  task5: {
    title: 'Invite a Friend',
    reward: 150,
    period: 'once'
  },

  task6: {
    title: 'Daily Learning',
    reward: 50,
    period: 'daily'
  },

  task7: {
    title: 'App Engagement',
    reward: 50,
    period: 'once'
  },

  task8: {
    title: 'Daily Activity',
    reward: 75,
    period: 'daily'
  },

  /*
    Compatibility with older dashboard IDs.
  */

  'daily-check-in': {
    title: 'Daily Check-in',
    reward: 50,
    period: 'daily'
  },

  'complete-profile': {
    title: 'Complete Profile',
    reward: 100,
    period: 'once'
  },

  'app-visit': {
    title: 'App Visit',
    reward: 25,
    period: 'daily'
  },

  'weekly-activity': {
    title: 'Weekly Activity',
    reward: 250,
    period: 'weekly'
  }
};

/* =========================================================
   SURVEYS
========================================================= */

const SURVEYS = {
  survey1: {
    title: 'Quick Opinion',
    reward: 150,
    period: 'once'
  },

  survey2: {
    title: 'User Experience',
    reward: 200,
    period: 'once'
  },

  survey3: {
    title: 'Rewards Survey',
    reward: 250,
    period: 'once'
  },

  survey4: {
    title: 'Shopping Survey',
    reward: 300,
    period: 'once'
  },

  survey5: {
    title: 'Technology Survey',
    reward: 250,
    period: 'once'
  },

  /*
    Compatibility with older IDs.
  */

  'quick-opinion': {
    title: 'Quick Opinion',
    reward: 150,
    period: 'once'
  },

  'shopping-survey': {
    title: 'Shopping Survey',
    reward: 300,
    period: 'once'
  },

  'technology-survey': {
    title: 'Technology Survey',
    reward: 250,
    period: 'once'
  }
};

/* =========================================================
   CLAIM REWARD
========================================================= */

async function handleClaimReward(body, req, res) {
  try {
    const token = getToken(req);

    if (!token) {
      return send(res, 401, {
        success: false,
        message: 'Authentication required'
      });
    }

    const user = await getUserFromToken(token);

    if (!user) {
      return send(res, 401, {
        success: false,
        message: 'Invalid or expired login session'
      });
    }

    const rewardType = String(
      body.rewardType ||
      body.reward_type ||
      body.type ||
      ''
    ).toLowerCase();

    const rewardId = String(
      body.rewardId ||
      body.reward_id ||
      body.taskId ||
      body.task_id ||
      body.surveyId ||
      body.survey_id ||
      ''
    );

    if (!rewardType) {
      return send(res, 400, {
        success: false,
        message: 'Reward type is required'
      });
    }

    if (!rewardId) {
      return send(res, 400, {
        success: false,
        message: 'Reward ID is required'
      });
    }

    let reward = null;

    if (rewardType === 'task') {
      reward = TASKS[rewardId];
    } else if (rewardType === 'survey') {
      reward = SURVEYS[rewardId];
    }

    if (!reward) {
      return send(res, 404, {
        success: false,
        message: 'Reward not found',
        rewardType,
        rewardId
      });
    }

    /*
      Make sure old reward_claims table is compatible.
    */
    await ensureRewardTable();

    /*
      Daily / weekly rewards need a different claim ID.
    */
    const now = new Date();

    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');

    const today = `${year}-${month}-${day}`;

    let claimRewardId = rewardId;

    if (reward.period === 'daily') {
      claimRewardId = `${rewardId}-${today}`;
    }

    if (reward.period === 'weekly') {
      const weekStart = new Date(now);

      weekStart.setUTCDate(
        weekStart.getUTCDate() -
        weekStart.getUTCDay()
      );

      const wy = weekStart.getUTCFullYear();
      const wm = String(
        weekStart.getUTCMonth() + 1
      ).padStart(2, '0');
      const wd = String(
        weekStart.getUTCDate()
      ).padStart(2, '0');

      claimRewardId = `${rewardId}-${wy}-${wm}-${wd}`;
    }

    /*
      Check whether this reward was already claimed.
    */

    const existing = await sql`
      SELECT id, coins, created_at
      FROM reward_claims
      WHERE user_id::text = ${String(user.id)}
        AND reward_type = ${rewardType}
        AND reward_id = ${claimRewardId}
      LIMIT 1
    `;

    if (existing.length > 0) {
      return send(res, 409, {
        success: false,
        message: 'Reward already claimed',
        rewardId,
        coins: Number(existing[0].coins || 0)
      });
    }

    /*
      Get/create wallet.
    */

    const walletBefore = await getWallet(user.id);

    if (!walletBefore) {
      throw new Error('Unable to create or find user wallet');
    }

    const walletId = walletBefore.id;

    /*
      Insert claim FIRST.
      We do not use ON CONFLICT here because the existing
      database may have an old/different unique constraint.
    */

    const claimId = crypto.randomUUID();

    try {
      await sql`
        INSERT INTO reward_claims (
          id,
          user_id,
          reward_type,
          reward_id,
          coins,
          created_at
        )
        VALUES (
          ${claimId},
          ${String(user.id)},
          ${rewardType},
          ${claimRewardId},
          ${Number(reward.reward)},
          NOW()
        )
      `;
    } catch (insertError) {
      /*
        If duplicate claim occurs because of an old unique
        constraint, return a clean response.
      */

      const msg = String(
        insertError.message || ''
      ).toLowerCase();

      if (
        msg.includes('duplicate') ||
        msg.includes('unique') ||
        insertError.code === '23505'
      ) {
        return send(res, 409, {
          success: false,
          message: 'Reward already claimed'
        });
      }

      throw insertError;
    }

    /*
      Add coins to wallet.
    */

    let walletAfter;

    try {
      const updated = await sql`
        UPDATE wallets
        SET
          balance = COALESCE(balance, 0) + ${Number(
            reward.reward
          )},
          total_earned = COALESCE(total_earned, 0) + ${Number(
            reward.reward
          )}
        WHERE id::text = ${String(walletId)}
        RETURNING *
      `;

      walletAfter = updated[0];
    } catch (walletError) {
      /*
        In case total_earned does not exist in an old database.
      */

      const msg = String(
        walletError.message || ''
      ).toLowerCase();

      if (msg.includes('total_earned')) {
        const updated = await sql`
          UPDATE wallets
          SET
            balance = COALESCE(balance, 0) + ${Number(
              reward.reward
            )}
          WHERE id::text = ${String(walletId)}
          RETURNING *
        `;

        walletAfter = updated[0];
      } else {
        throw walletError;
      }
    }

    if (!walletAfter) {
      throw new Error('Wallet update failed');
    }

    /*
      Sync users.coins if that column exists.
      This is deliberately non-fatal because wallet is the
      primary balance source.
    */

    try {
      await sql`
        UPDATE users
        SET coins = COALESCE(coins, 0) + ${Number(
          reward.reward
        )}
        WHERE id::text = ${String(user.id)}
      `;
    } catch (userCoinsError) {
      console.warn(
        'users.coins sync skipped:',
        userCoinsError.message
      );
    }

    return send(res, 200, {
      success: true,
      message: 'Reward claimed successfully',
      reward: {
        type: rewardType,
        id: rewardId,
        title: reward.title,
        coins: Number(reward.reward)
      },
      wallet: {
        balance: Number(walletAfter.balance || 0),
        total_earned: Number(
          walletAfter.total_earned || 0
        ),
        total_withdrawn: Number(
          walletAfter.total_withdrawn || 0
        )
      }
    });

  } catch (error) {
    console.error(
      'Reward claim error:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Reward claim database error',
      error: error?.message || String(error),
      code: error?.code || null,
      detail: error?.detail || null,
      hint: error?.hint || null,
      position: error?.position || null
    });
  }
}

/* =========================================================
   WALLET API
========================================================= */

async function handleWallet(req, res) {
  try {
    const token = getToken(req);

    if (!token) {
      return send(res, 401, {
        success: false,
        message: 'Authentication required'
      });
    }

    const user = await getUserFromToken(token);

    if (!user) {
      return send(res, 401, {
        success: false,
        message: 'Invalid or expired login session'
      });
    }

    const wallet = await getWallet(user.id);

    return send(res, 200, {
      success: true,
      wallet: {
        balance: Number(wallet.balance || 0),
        total_earned: Number(wallet.total_earned || 0),
        total_withdrawn: Number(
          wallet.total_withdrawn || 0
        )
      }
    });

  } catch (error) {
    console.error('Wallet error:', error);

    return send(res, 500, {
      success: false,
      message: 'Unable to load wallet',
      error: error.message
    });
  }
}

/* =========================================================
   DAILY BONUS
========================================================= */

async function handleDailyBonus(req, res) {
  return handleClaimReward(
    {
      rewardType: 'task',
      rewardId: 'task1'
    },
    req,
    res
  );
}

/* =========================================================
   REGISTER
========================================================= */

async function handleRegister(body, res) {
  try {
    const name = String(body.name || '').trim();
    const username = String(
      body.username || ''
    ).trim();
    const email = String(
      body.email || ''
    ).trim().toLowerCase();
    const password = String(
      body.password || ''
    );
    const phone = String(
      body.phone || ''
    ).trim();

    if (
      !name ||
      !username ||
      !email ||
      !password
    ) {
      return send(res, 400, {
        success: false,
        message:
          'Name, username, email and password are required'
      });
    }

    if (password.length < 6) {
      return send(res, 400, {
        success: false,
        message:
          'Password must be at least 6 characters'
      });
    }

    const existing = await sql`
      SELECT id
      FROM users
      WHERE LOWER(email) = ${email}
         OR LOWER(username) = ${username.toLowerCase()}
      LIMIT 1
    `;

    if (existing.length > 0) {
      return send(res, 409, {
        success: false,
        message:
          'Email or username already exists'
      });
    }

    const userId =
      'user-' + crypto.randomUUID();

    const passwordHash =
      crypto
        .createHash('sha256')
        .update(password)
        .digest('hex');

    await sql`
      INSERT INTO users (
        id,
        name,
        username,
        email,
        password_hash,
        phone,
        role,
        coins
      )
      VALUES (
        ${userId},
        ${name},
        ${username},
        ${email},
        ${passwordHash},
        ${phone},
        'user',
        0
      )
    `;

    const walletId = crypto.randomUUID();

    try {
      await sql`
        INSERT INTO wallets (
          id,
          user_id,
          balance,
          total_earned,
          total_withdrawn
        )
        VALUES (
          ${walletId},
          ${userId},
          0,
          0,
          0
        )
      `;
    } catch (walletError) {
      if (
        String(walletError.message || '')
          .toLowerCase()
          .includes('total_withdrawn')
      ) {
        await sql`
          INSERT INTO wallets (
            id,
            user_id,
            balance,
            total_earned
          )
          VALUES (
            ${walletId},
            ${userId},
            0,
            0
          )
        `;
      } else {
        throw walletError;
      }
    }

    return send(res, 201, {
      success: true,
      message:
        'Account created successfully',
      user: {
        id: userId,
        name,
        username,
        email,
        phone,
        role: 'user',
        coins: 0
      }
    });

  } catch (error) {
    console.error(
      'Registration error:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Unable to create account',
      error: error.message
    });
  }
}

/* =========================================================
   LOGIN
========================================================= */

async function handleLogin(body, res) {
  try {
    const email = String(
      body.email || ''
    ).trim().toLowerCase();

    const password = String(
      body.password || ''
    );

    if (!email || !password) {
      return send(res, 400, {
        success: false,
        message:
          'Email and password are required'
      });
    }

    const passwordHash =
      crypto
        .createHash('sha256')
        .update(password)
        .digest('hex');

    const users = await sql`
      SELECT *
      FROM users
      WHERE LOWER(email) = ${email}
        AND password_hash = ${passwordHash}
      LIMIT 1
    `;

    if (users.length === 0) {
      return send(res, 401, {
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = users[0];

    const token = crypto
      .randomBytes(32)
      .toString('hex');

    const sessionId =
      crypto.randomUUID();

    await sql`
      INSERT INTO admin_sessions (
        id,
        user_id,
        token,
        expires_at
      )
      VALUES (
        ${sessionId},
        ${String(user.id)},
        ${token},
        NOW() + INTERVAL '30 days'
      )
    `;

    const wallet = await getWallet(
      user.id
    );

    return send(res, 200, {
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone || '',
        role: user.role || 'user',
        coins: Number(
          wallet?.balance ||
          user.coins ||
          0
        )
      },
      wallet: {
        balance: Number(
          wallet?.balance || 0
        ),
        total_earned: Number(
          wallet?.total_earned || 0
        ),
        total_withdrawn: Number(
          wallet?.total_withdrawn || 0
        )
      }
    });

  } catch (error) {
    console.error(
      'Login error:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Unable to login',
      error: error.message
    });
  }
}

/* =========================================================
   HEALTH
========================================================= */

async function handleHealth(res) {
  try {
    const result = await sql`
      SELECT NOW() AS database_time
    `;

    return send(res, 200, {
      ok: true,
      success: true,
      service: 'EarnNest API',
      status: 'running',
      database: 'connected',
      databaseTime:
        result[0]?.database_time || null
    });

  } catch (error) {
    return send(res, 500, {
      ok: false,
      success: false,
      service: 'EarnNest API',
      status: 'error',
      database: 'disconnected',
      error: error.message
    });
  }
}

/* =========================================================
   MAIN HANDLER
========================================================= */

module.exports = async function handler(
  req,
  res
) {
  try {
    if (req.method === 'OPTIONS') {
      return send(res, 200, {
        success: true
      });
    }

    /*
      Health request
    */
    if (
      req.url === '/api/health' ||
      req.url?.startsWith('/api/health?')
    ) {
      return handleHealth(res);
    }

    if (req.method === 'GET') {
      return send(res, 200, {
        success: true,
        service: 'EarnNest API',
        status: 'running'
      });
    }

    if (req.method !== 'POST') {
      return send(res, 405, {
        success: false,
        message: 'Method not allowed'
      });
    }

    const body = await readBody(req);

    const action = String(
      body.action || ''
    ).toLowerCase();

    /*
      Register
    */
    if (
      action === 'register' ||
      action === 'signup' ||
      action === 'create_account'
    ) {
      return handleRegister(
        body,
        res
      );
    }

    /*
      Login
    */
    if (
      action === 'login' ||
      action === 'signin'
    ) {
      return handleLogin(
        body,
        res
      );
    }

    /*
      Reward
    */
    if (
      action === 'claim_reward' ||
      action === 'complete_task' ||
      action === 'complete_survey' ||
      action === 'claim_task' ||
      action === 'claim_survey'
    ) {
      return handleClaimReward(
        body,
        req,
        res
      );
    }

    /*
      Daily bonus
    */
    if (
      action === 'daily_bonus'
    ) {
      return handleDailyBonus(
        req,
        res
      );
    }

    /*
      Wallet
    */
    if (
      action === 'wallet' ||
      action === 'get_wallet' ||
      action === 'balance'
    ) {
      return handleWallet(
        req,
        res
      );
    }

    /*
      Allow reward request even if dashboard
      does not send an action but sends rewardType.
    */
    if (
      body.rewardType ||
      body.reward_type ||
      body.rewardId ||
      body.reward_id
    ) {
      return handleClaimReward(
        body,
        req,
        res
      );
    }

    return send(res, 400, {
      success: false,
      message: 'Unknown API action'
    });

  } catch (error) {
    console.error(
      'API error:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Server error',
      error: error?.message ||
        String(error)
    });
  }
};
