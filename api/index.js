'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

/* =========================================================
   RESPONSE
========================================================= */

function send(res, status, data) {
  res.statusCode = status;

  res.setHeader(
    'Content-Type',
    'application/json; charset=utf-8'
  );

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

  return res.end(JSON.stringify(data));
}


/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function getToken(req) {
  const auth = clean(req.headers.authorization || '');

  if (!auth) {
    return '';
  }

  return auth.replace(/^Bearer\s+/i, '').trim();
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


/* =========================================================
   REFERRAL
========================================================= */

function makeReferralCode(username) {
  const base = clean(username)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);

  const random = crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase();

  return `${base || 'USER'}${random}`;
}

async function createUniqueReferralCode(username) {
  for (let i = 0; i < 10; i++) {
    const code = makeReferralCode(username);

    const rows = await sql`
      SELECT id
      FROM users
      WHERE referral_code = ${code}
      LIMIT 1
    `;

    if (!rows.length) {
      return code;
    }
  }

  throw new Error('Unable to create referral code');
}


/* =========================================================
   SESSION
========================================================= */

async function getUserFromToken(token) {
  if (!token) {
    return null;
  }

  const rows = await sql`
    SELECT
      u.*
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
    SELECT
      *
    FROM wallets
    WHERE user_id::text = ${String(userId)}
    LIMIT 1
  `;

  if (!rows.length) {
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
        ${String(userId)},
        0,
        0,
        0
      )
      ON CONFLICT DO NOTHING
    `;

    rows = await sql`
      SELECT
        *
      FROM wallets
      WHERE user_id::text = ${String(userId)}
      LIMIT 1
    `;
  }

  return rows[0] || {
    balance: 0,
    total_earned: 0,
    total_withdrawn: 0
  };
}


/* =========================================================
   REGISTER
========================================================= */

async function handleRegister(body, res) {
  const name = clean(body.name);
  const username = clean(body.username).toLowerCase();
  const userEmail = normalizeEmail(body.email);
  const phone = clean(body.phone);

  const password = String(body.password || '');

  const confirmPassword = String(
    body.confirmPassword ||
    body.confirm ||
    ''
  );

  const referralCode = clean(
    body.referralCode ||
    body.ref ||
    ''
  ).toUpperCase();

  if (
    !name ||
    !username ||
    !userEmail ||
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

  if (password !== confirmPassword) {
    return send(res, 400, {
      success: false,
      message:
        'Passwords do not match'
    });
  }

  try {
    const existing = await sql`
      SELECT
        id,
        username,
        email
      FROM users
      WHERE LOWER(username) = ${username}
         OR LOWER(email) = ${userEmail}
      LIMIT 1
    `;

    if (existing.length) {
      const found = existing[0];

      if (
        String(found.username).toLowerCase() ===
        username
      ) {
        return send(res, 409, {
          success: false,
          message:
            'Username already exists'
        });
      }

      return send(res, 409, {
        success: false,
        message:
          'Email already exists'
      });
    }

    let referrer = null;

    if (referralCode) {
      const refRows = await sql`
        SELECT
          id,
          username,
          referral_code
        FROM users
        WHERE UPPER(referral_code) = ${referralCode}
        LIMIT 1
      `;

      if (!refRows.length) {
        return send(res, 400, {
          success: false,
          message:
            'Invalid referral code'
        });
      }

      referrer = refRows[0];

      if (
        String(referrer.username).toLowerCase() ===
        username
      ) {
        return send(res, 400, {
          success: false,
          message:
            'You cannot use your own referral code'
        });
      }
    }

    const userId = `user-${crypto.randomUUID()}`;

    const newReferralCode =
      await createUniqueReferralCode(username);

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
        coins,
        referral_code,
        referred_by,
        created_at
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
        0,
        ${newReferralCode},
        ${
          referrer
            ? referrer.referral_code
            : null
        },
        NOW()
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
      ON CONFLICT DO NOTHING
    `;

    if (referrer) {
      const bonus = 100;

      try {
        await sql`
          INSERT INTO referrals
          (
            id,
            referrer_id,
            referred_user_id,
            referral_code,
            bonus_coins,
            status,
            created_at
          )
          VALUES
          (
            ${crypto.randomUUID()},
            ${referrer.id},
            ${userId},
            ${referralCode},
            ${bonus},
            'completed',
            NOW()
          )
        `;

        await sql`
          UPDATE wallets
          SET
            balance =
              COALESCE(balance, 0) + ${bonus},

            total_earned =
              COALESCE(total_earned, 0) + ${bonus}

          WHERE user_id::text =
                ${String(referrer.id)}
        `;

        await sql`
          UPDATE users
          SET
            coins =
              COALESCE(coins, 0) + ${bonus}

          WHERE id::text =
                ${String(referrer.id)}
        `;
      } catch (referralError) {
        console.error(
          'Referral bonus error:',
          referralError
        );
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
        email: userEmail,
        phone,
        role: 'user',
        coins: 0,
        balance: 0,
        referralCode:
          newReferralCode,
        referredBy:
          referrer
            ? referrer.referral_code
            : null
      }
    });

  } catch (error) {
    console.error(
      'Registration API error:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Registration failed',
      error:
        error.message
    });
  }
}


/* =========================================================
   LOGIN
========================================================= */

async function handleLogin(body, res) {
  const login = normalizeEmail(
    body.login ||
    body.email ||
    body.username
  );

  const password =
    String(body.password || '');

  if (!login || !password) {
    return send(res, 400, {
      success: false,
      message:
        'Email/username and password are required'
    });
  }

  try {
    let rows = await sql`
      SELECT *
      FROM users
      WHERE LOWER(email) = ${login}
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

    if (
      !user ||
      String(user.password) !== password
    ) {
      return send(res, 401, {
        success: false,
        message:
          'Invalid email/username or password'
      });
    }

    const token = crypto.randomUUID();

    await sql`
      INSERT INTO admin_sessions
      (
        user_id,
        token,
        expires_at
      )
      VALUES
      (
        ${user.id},
        ${token},
        NOW() + INTERVAL '30 days'
      )
    `;

    const wallet =
      await getWallet(user.id);

    const balance =
      Number(
        wallet.balance ??
        user.coins ??
        0
      );

    const totalEarned =
      Number(
        wallet.total_earned ??
        0
      );

    const totalWithdrawn =
      Number(
        wallet.total_withdrawn ??
        0
      );

    return send(res, 200, {
      success: true,

      message:
        'Login successful',

      token,

      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,

        role:
          user.role || 'user',

        coins:
          balance,

        balance:
          balance,

        totalEarned,
        totalWithdrawn,

        referralCode:
          user.referral_code || '',

        referredBy:
          user.referred_by || ''
      }
    });

  } catch (error) {
    console.error(
      'Login API error:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Login server error',
      error:
        error.message
    });
  }
}


/* =========================================================
   REWARD TABLE
========================================================= */

async function ensureRewardTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS reward_claims
    (
      id UUID PRIMARY KEY,

      user_id TEXT NOT NULL,

      reward_type TEXT NOT NULL,

      reward_id TEXT NOT NULL,

      coins INTEGER NOT NULL,

      created_at TIMESTAMP DEFAULT NOW(),

      UNIQUE
      (
        user_id,
        reward_type,
        reward_id
      )
    )
  `;

  /*
   * Compatibility for older table versions.
   */

  try {
    await sql`
      ALTER TABLE reward_claims
      ALTER COLUMN user_id TYPE TEXT
      USING user_id::TEXT
    `;
  } catch (error) {
    console.log(
      'reward_claims user_id migration:',
      error.message
    );
  }

  try {
    await sql`
      ALTER TABLE reward_claims
      ALTER COLUMN reward_type TYPE TEXT
      USING reward_type::TEXT
    `;
  } catch (error) {
    console.log(
      'reward_claims reward_type migration:',
      error.message
    );
  }

  try {
    await sql`
      ALTER TABLE reward_claims
      ALTER COLUMN reward_id TYPE TEXT
      USING reward_id::TEXT
    `;
  } catch (error) {
    console.log(
      'reward_claims reward_id migration:',
      error.message
    );
  }
}


/* =========================================================
   TASKS
========================================================= */

const TASKS = {
  task1: {
    title: 'Daily Check-in',
    description:
      'Check in daily and receive your reward.',
    coins: 50,
    daily: true
  },

  task2: {
    title: 'Follow Social Page',
    description:
      'Visit and follow the EarnNest social page.',
    coins: 100,
    daily: false
  },

  task3: {
    title: 'Read EarnNest Guide',
    description:
      'Read the earning guide and learn how EarnNest works.',
    coins: 75,
    daily: false
  },

  task4: {
    title: 'Complete Profile',
    description:
      'Make sure your profile information is complete.',
    coins: 100,
    daily: false
  },

  task5: {
    title: 'Invite a Friend',
    description:
      'Invite a new user using your referral code.',
    coins: 150,
    daily: false
  },

  task6: {
    title: 'Daily Learning',
    description:
      'Read today’s short earning tip.',
    coins: 50,
    daily: true
  },

  task7: {
    title: 'App Engagement',
    description:
      'Visit the main sections of your EarnNest dashboard.',
    coins: 50,
    daily: false
  },

  task8: {
    title: 'Daily Activity',
    description:
      'Complete today’s EarnNest activity.',
    coins: 75,
    daily: true
  },

  /*
   * Compatibility with separate task endpoint IDs.
   */

  'daily-check-in': {
    title: 'Daily Check-in',
    description:
      'Check in daily and receive your reward.',
    coins: 50,
    daily: true
  },

  'complete-profile': {
    title: 'Complete Profile',
    description:
      'Complete your profile.',
    coins: 100,
    daily: false
  },

  'app-visit': {
    title: 'App Visit',
    description:
      'Visit EarnNest.',
    coins: 25,
    daily: true
  },

  'weekly-activity': {
    title: 'Weekly Activity',
    description:
      'Complete weekly activity.',
    coins: 250,
    daily: false
  }
};


/* =========================================================
   SURVEYS
========================================================= */

const SURVEYS = {
  survey1: {
    title: 'Quick Opinion Survey',
    description:
      'Answer 3 quick questions.',
    coins: 150,
    daily: false
  },

  survey2: {
    title: 'User Experience Survey',
    description:
      'Tell us about your EarnNest experience.',
    coins: 200,
    daily: false
  },

  survey3: {
    title: 'Rewards Survey',
    description:
      'Answer a short survey about reward preferences.',
    coins: 250,
    daily: false
  },

  survey4: {
    title: 'Shopping Survey',
    description:
      'Answer questions about shopping habits.',
    coins: 300,
    daily: false
  },

  survey5: {
    title: 'Technology Survey',
    description:
      'Complete a short technology opinion survey.',
    coins: 250,
    daily: false
  },

  /*
   * Compatibility IDs.
   */

  'quick-opinion': {
    title: 'Quick Opinion Survey',
    description:
      'Answer 3 quick questions.',
    coins: 150,
    daily: false
  },

  'shopping-survey': {
    title: 'Shopping Survey',
    description:
      'Answer questions about shopping habits.',
    coins: 300,
    daily: false
  },

  'technology-survey': {
    title: 'Technology Survey',
    description:
      'Complete a short technology opinion survey.',
    coins: 250,
    daily: false
  }
};


/* =========================================================
   CLAIM REWARD
========================================================= */

async function handleClaimReward(body, req, res) {
  const token = getToken(req);

  if (!token) {
    return send(res, 401, {
      success: false,
      message:
        'Login session is required'
    });
  }

  try {
    const user =
      await getUserFromToken(token);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Session expired. Please login again.'
      });
    }

    const rewardType =
      clean(body.rewardType)
        .toLowerCase();

    const rewardId =
      clean(
        body.rewardId ||
        body.reward_id ||
        body.taskId ||
        body.task_id ||
        body.surveyId ||
        body.survey_id
      );

    if (
      rewardType !== 'task' &&
      rewardType !== 'survey'
    ) {
      return send(res, 400, {
        success: false,
        message:
          'Invalid reward type'
      });
    }

    if (!rewardId) {
      return send(res, 400, {
        success: false,
        message:
          'Reward ID is missing'
      });
    }

    let reward = null;

    if (rewardType === 'task') {
      reward = TASKS[rewardId];
    }

    if (rewardType === 'survey') {
      reward = SURVEYS[rewardId];
    }

    if (!reward) {
      return send(res, 404, {
        success: false,
        message:
          `Reward not found: ${rewardId}`
      });
    }

    await ensureRewardTable();

    const userId =
      String(user.id);

    /*
     * Daily reward gets a date-specific ID.
     */

    let claimId = rewardId;

    if (reward.daily) {
      const today =
        new Date()
          .toISOString()
          .slice(0, 10);

      claimId =
        `${rewardId}-${today}`;
    }

    /*
     * Check previous claim.
     */

    const alreadyClaimed =
      await sql`
        SELECT id
        FROM reward_claims
        WHERE user_id = ${userId}
          AND reward_type = ${rewardType}
          AND reward_id = ${claimId}
        LIMIT 1
      `;

    if (alreadyClaimed.length) {
      return send(res, 409, {
        success: false,
        alreadyClaimed: true,
        message:
          reward.daily
            ? 'This daily reward has already been claimed today.'
            : 'This reward has already been claimed.'
      });
    }

    /*
     * Make sure wallet exists.
     */

    const existingWallet =
      await getWallet(userId);

    if (!existingWallet) {
      return send(res, 500, {
        success: false,
        message:
          'Wallet could not be created'
      });
    }

    /*
     * Insert claim.
     *
     * The UNIQUE constraint prevents
     * duplicate reward claims.
     */

    let claim;

    try {
      claim = await sql`
        INSERT INTO reward_claims
        (
          id,
          user_id,
          reward_type,
          reward_id,
          coins,
          created_at
        )
        VALUES
        (
          ${crypto.randomUUID()},
          ${userId},
          ${rewardType},
          ${claimId},
          ${reward.coins},
          NOW()
        )
        ON CONFLICT
        (
          user_id,
          reward_type,
          reward_id
        )
        DO NOTHING

        RETURNING id
      `;
    } catch (claimError) {
      console.error(
        'Reward claim insert error:',
        claimError
      );

      throw claimError;
    }

    if (!claim.length) {
      return send(res, 409, {
        success: false,
        alreadyClaimed: true,
        message:
          'This reward has already been claimed.'
      });
    }

    /*
     * Add coins to wallet.
     */

    const updatedWallet =
      await sql`
        UPDATE wallets
        SET
          balance =
            COALESCE(balance, 0)
            + ${reward.coins},

          total_earned =
            COALESCE(total_earned, 0)
            + ${reward.coins}

        WHERE user_id::text = ${userId}

        RETURNING
          balance,
          total_earned,
          total_withdrawn
      `;

    if (!updatedWallet.length) {
      /*
       * Claim exists but wallet was not updated.
       * Report the actual database problem.
       */
      return send(res, 500, {
        success: false,
        message:
          'Wallet update failed',
        error:
          'No wallet row found for this user'
      });
    }

    const newBalance =
      Number(
        updatedWallet[0].balance || 0
      );

    const newTotalEarned =
      Number(
        updatedWallet[0].total_earned || 0
      );

    /*
     * Synchronize users.coins.
     */

    try {
      await sql`
        UPDATE users
        SET
          coins = ${newBalance}
        WHERE id::text = ${userId}
      `;
    } catch (syncError) {
      console.error(
        'users.coins sync error:',
        syncError
      );

      /*
       * Wallet is the main balance.
       * Do not cancel the reward because
       * of a users.coins synchronization issue.
       */
    }

    return send(res, 200, {
      success: true,

      message:
        `${reward.coins} coins added successfully.`,

      reward: {
        type: rewardType,
        id: rewardId,
        coins: reward.coins,
        title: reward.title
      },

      wallet: {
        balance:
          newBalance,

        coins:
          newBalance,

        totalEarned:
          newTotalEarned,

        totalWithdrawn:
          Number(
            updatedWallet[0].total_withdrawn || 0
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

      message:
        'Unable to process reward',

      error:
        error.message ||
        'Unknown database error'
    });
  }
}


/* =========================================================
   WALLET INFO
========================================================= */

async function handleWallet(req, res) {
  const token =
    getToken(req);

  if (!token) {
    return send(res, 401, {
      success: false,
      message:
        'Login session is required'
    });
  }

  try {
    const user =
      await getUserFromToken(token);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Session expired'
      });
    }

    const wallet =
      await getWallet(user.id);

    return send(res, 200, {
      success: true,

      wallet: {
        balance:
          Number(wallet.balance || 0),

        coins:
          Number(wallet.balance || 0),

        totalEarned:
          Number(
            wallet.total_earned || 0
          ),

        totalWithdrawn:
          Number(
            wallet.total_withdrawn || 0
          )
      }
    });

  } catch (error) {
    console.error(
      'Wallet error:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to load wallet',
      error:
        error.message
    });
  }
}


/* =========================================================
   DAILY BONUS
========================================================= */

async function handleDailyBonus(req, res) {
  const token =
    getToken(req);

  if (!token) {
    return send(res, 401, {
      success: false,
      message:
        'Login session is required'
    });
  }

  try {
    const user =
      await getUserFromToken(token);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Session expired'
      });
    }

    const today =
      new Date()
        .toISOString()
        .slice(0, 10);

    await ensureRewardTable();

    const claimId =
      `daily-bonus-${today}`;

    const existing =
      await sql`
        SELECT id
        FROM reward_claims
        WHERE user_id = ${String(user.id)}
          AND reward_type = 'daily_bonus'
          AND reward_id = ${claimId}
        LIMIT 1
      `;

    if (existing.length) {
      return send(res, 409, {
        success: false,
        message:
          'Daily bonus already claimed today.'
      });
    }

    const bonus = 50;

    const claim =
      await sql`
        INSERT INTO reward_claims
        (
          id,
          user_id,
          reward_type,
          reward_id,
          coins,
          created_at
        )
        VALUES
        (
          ${crypto.randomUUID()},
          ${String(user.id)},
          'daily_bonus',
          ${claimId},
          ${bonus},
          NOW()
        )
        ON CONFLICT
        (
          user_id,
          reward_type,
          reward_id
        )
        DO NOTHING

        RETURNING id
      `;

    if (!claim.length) {
      return send(res, 409, {
        success: false,
        message:
          'Daily bonus already claimed today.'
      });
    }

    const updated =
      await sql`
        UPDATE wallets
        SET
          balance =
            COALESCE(balance, 0) + ${bonus},

          total_earned =
            COALESCE(total_earned, 0) + ${bonus}

        WHERE user_id::text =
              ${String(user.id)}

        RETURNING
          balance,
          total_earned,
          total_withdrawn
      `;

    if (!updated.length) {
      return send(res, 500, {
        success: false,
        message:
          'Wallet update failed'
      });
    }

    const balance =
      Number(updated[0].balance || 0);

    try {
      await sql`
        UPDATE users
        SET
          coins = ${balance}
        WHERE id::text =
              ${String(user.id)}
      `;
    } catch (syncError) {
      console.error(
        'Daily bonus coins sync:',
        syncError
      );
    }

    return send(res, 200, {
      success: true,

      message:
        'Daily bonus added successfully.',

      wallet: {
        balance,

        coins:
          balance,

        totalEarned:
          Number(
            updated[0].total_earned || 0
          ),

        totalWithdrawn:
          Number(
            updated[0].total_withdrawn || 0
          )
      }
    });

  } catch (error) {
    console.error(
      'Daily bonus error:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to claim daily bonus',
      error:
        error.message
    });
  }
}


/* =========================================================
   HEALTH
========================================================= */

async function handleHealth(req, res) {
  try {
    const rows = await sql`
      SELECT NOW() AS database_time
    `;

    return send(res, 200, {
      ok: true,
      success: true,
      service: 'EarnNest API',
      status: 'running',
      database: 'connected',
      databaseTime:
        rows[0]?.database_time || null
    });

  } catch (error) {
    return send(res, 500, {
      ok: false,
      success: false,
      service: 'EarnNest API',
      status: 'error',
      database: 'disconnected',
      error:
        error.message
    });
  }
}


/* =========================================================
   MAIN API
========================================================= */

module.exports = async function(req, res) {

  /*
   * CORS preflight
   */

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

  /*
   * Health check
   */

  if (
    req.method === 'GET' &&
    (
      req.url === '/' ||
      req.url === '/api' ||
      req.url === '/api/health'
    )
  ) {
    return handleHealth(req, res);
  }

  /*
   * All remaining API actions use POST.
   */

  if (req.method !== 'POST') {
    return send(res, 405, {
      success: false,
      message:
        'Method not allowed. Use POST.'
    });
  }

  try {
    const body =
      await readBody(req);

    /*
     * REGISTER
     */

    if (
      body.action === 'register'
    ) {
      return await handleRegister(
        body,
        res
      );
    }

    /*
     * LOGIN
     */

    if (
      body.action === 'login' ||
      !body.action
    ) {
      return await handleLogin(
        body,
        res
      );
    }

    /*
     * CLAIM TASK / SURVEY
     */

    if (
      body.action === 'claim_reward'
    ) {
      return await handleClaimReward(
        body,
        req,
        res
      );
    }

    /*
     * WALLET
     */

    if (
      body.action === 'wallet'
    ) {
      return await handleWallet(
        req,
        res
      );
    }

    /*
     * DAILY BONUS
     */

    if (
      body.action === 'daily_bonus'
    ) {
      return await handleDailyBonus(
        req,
        res
      );
    }

    /*
     * Explicit task completion compatibility.
     */

    if (
      body.action === 'complete_task'
    ) {
      body.rewardType = 'task';
      body.rewardId =
        body.rewardId ||
        body.taskId ||
        body.task_id;

      return await handleClaimReward(
        body,
        req,
        res
      );
    }

    /*
     * Explicit survey completion compatibility.
     */

    if (
      body.action === 'complete_survey'
    ) {
      body.rewardType = 'survey';
      body.rewardId =
        body.rewardId ||
        body.surveyId ||
        body.survey_id;

      return await handleClaimReward(
        body,
        req,
        res
      );
    }

    return send(res, 400, {
      success: false,
      message:
        'Unknown action'
    });

  } catch (error) {
    console.error(
      'API error:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Server error',
      error:
        error.message
    });
  }
};
