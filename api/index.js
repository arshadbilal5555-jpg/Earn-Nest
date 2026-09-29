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

  return res.end(
    JSON.stringify(data)
  );
}

/* =========================================================
   BODY
========================================================= */

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
      } catch (error) {
        reject(
          new Error('Invalid JSON request')
        );
      }
    });

    req.on('error', reject);
  });
}

/* =========================================================
   TOKEN
========================================================= */

function getToken(req) {
  const authorization =
    req.headers?.authorization || '';

  if (!authorization) {
    return null;
  }

  if (
    authorization
      .toLowerCase()
      .startsWith('bearer ')
  ) {
    return authorization
      .substring(7)
      .trim();
  }

  return authorization.trim();
}

/* =========================================================
   USER FROM SESSION
========================================================= */

async function getUserFromToken(token) {
  if (!token) {
    return null;
  }

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

  const walletId =
    crypto.randomUUID();

  await sql`
    INSERT INTO wallets (
      id,
      user_id,
      balance,
      total_earned,
      total_withdrawn,
      created_at,
      updated_at
    )
    VALUES (
      ${walletId},
      ${String(userId)},
      0,
      0,
      0,
      NOW(),
      NOW()
    )
  `;

  rows = await sql`
    SELECT *
    FROM wallets
    WHERE user_id::text = ${String(userId)}
    LIMIT 1
  `;

  return rows[0] || null;
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

  /* Older IDs */

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

  /* Older IDs */

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

async function handleClaimReward(
  body,
  req,
  res
) {
  try {

    const token = getToken(req);

    if (!token) {
      return send(res, 401, {
        success: false,
        message:
          'Authentication required'
      });
    }

    const user =
      await getUserFromToken(token);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Invalid or expired login session'
      });
    }

    const rewardType =
      String(
        body.rewardType ||
        body.reward_type ||
        body.type ||
        ''
      )
        .trim()
        .toLowerCase();

    const referenceKey =
      String(
        body.rewardId ||
        body.reward_id ||
        body.referenceKey ||
        body.reference_key ||
        body.taskId ||
        body.task_id ||
        body.surveyId ||
        body.survey_id ||
        ''
      ).trim();

    if (!rewardType) {
      return send(res, 400, {
        success: false,
        message:
          'Reward type is required'
      });
    }

    if (!referenceKey) {
      return send(res, 400, {
        success: false,
        message:
          'Reward reference is required'
      });
    }

    let reward = null;

    if (rewardType === 'task') {
      reward = TASKS[referenceKey];
    }

    if (rewardType === 'survey') {
      reward = SURVEYS[referenceKey];
    }

    if (!reward) {
      return send(res, 404, {
        success: false,
        message:
          'Reward not found',
        rewardType,
        referenceKey
      });
    }

    /* -----------------------------------------
       DAILY / WEEKLY REFERENCE
    ----------------------------------------- */

    const now =
      new Date();

    const year =
      now.getUTCFullYear();

    const month =
      String(
        now.getUTCMonth() + 1
      ).padStart(2, '0');

    const day =
      String(
        now.getUTCDate()
      ).padStart(2, '0');

    const today =
      `${year}-${month}-${day}`;

    let claimReference =
      referenceKey;

    if (reward.period === 'daily') {
      claimReference =
        `${referenceKey}-${today}`;
    }

    if (reward.period === 'weekly') {

      const weekDate =
        new Date(now);

      weekDate.setUTCDate(
        weekDate.getUTCDate() -
        weekDate.getUTCDay()
      );

      const weekYear =
        weekDate.getUTCFullYear();

      const weekMonth =
        String(
          weekDate.getUTCMonth() + 1
        ).padStart(2, '0');

      const weekDay =
        String(
          weekDate.getUTCDate()
        ).padStart(2, '0');

      claimReference =
        `${referenceKey}-${weekYear}-${weekMonth}-${weekDay}`;
    }

    /* -----------------------------------------
       CHECK EXISTING CLAIM
    ----------------------------------------- */

    const existing =
      await sql`
        SELECT
          id,
          amount,
          created_at
        FROM reward_claims
        WHERE user_id::text =
              ${String(user.id)}
          AND reward_type =
              ${rewardType}
          AND reference_key =
              ${claimReference}
        LIMIT 1
      `;

    if (existing.length > 0) {

      return send(res, 409, {
        success: false,
        message:
          'Reward already claimed',
        referenceKey,
        amount:
          Number(
            existing[0].amount || 0
          )
      });
    }

    /* -----------------------------------------
       WALLET
    ----------------------------------------- */

    const wallet =
      await getWallet(user.id);

    if (!wallet) {
      throw new Error(
        'User wallet not found'
      );
    }

    const amount =
      Number(reward.reward);

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      throw new Error(
        'Invalid reward amount'
      );
    }

    /* -----------------------------------------
       INSERT CLAIM

       IMPORTANT:
       Existing database uses:
       reference_key
       title
       amount
    ----------------------------------------- */

    const claimId =
      crypto.randomUUID();

    try {

      await sql`
        INSERT INTO reward_claims (
          id,
          user_id,
          reward_type,
          reference_key,
          title,
          amount,
          created_at
        )
        VALUES (
          ${claimId},
          ${String(user.id)},
          ${rewardType},
          ${claimReference},
          ${reward.title},
          ${amount},
          NOW()
        )
      `;

    } catch (claimError) {

      const errorText =
        String(
          claimError.message || ''
        ).toLowerCase();

      if (
        claimError.code === '23505' ||
        errorText.includes('duplicate') ||
        errorText.includes('unique')
      ) {

        return send(res, 409, {
          success: false,
          message:
            'Reward already claimed'
        });
      }

      throw claimError;
    }

    /* -----------------------------------------
       UPDATE WALLET
    ----------------------------------------- */

    const updatedWallet =
      await sql`
        UPDATE wallets
        SET
          balance =
            COALESCE(balance, 0)
            + ${amount},

          total_earned =
            COALESCE(total_earned, 0)
            + ${amount},

          updated_at = NOW()

        WHERE user_id::text =
              ${String(user.id)}

        RETURNING *
      `;

    if (
      updatedWallet.length === 0
    ) {
      throw new Error(
        'Wallet update failed'
      );
    }

    const finalWallet =
      updatedWallet[0];

    /* -----------------------------------------
       SYNC USERS.COINS

       If this fails, wallet still remains
       the main balance.
    ----------------------------------------- */

    try {

      await sql`
        UPDATE users
        SET coins =
          COALESCE(coins, 0)
          + ${amount}
        WHERE id::text =
          ${String(user.id)}
      `;

    } catch (coinsError) {

      console.warn(
        'users.coins update skipped:',
        coinsError.message
      );
    }

    /* -----------------------------------------
       SUCCESS
    ----------------------------------------- */

    return send(res, 200, {

      success: true,

      message:
        'Reward claimed successfully',

      reward: {
        type: rewardType,
        id: referenceKey,
        title: reward.title,
        coins: amount
      },

      wallet: {
        balance:
          Number(
            finalWallet.balance || 0
          ),

        total_earned:
          Number(
            finalWallet.total_earned || 0
          ),

        total_withdrawn:
          Number(
            finalWallet.total_withdrawn || 0
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
        'Reward claim database error',

      error:
        error?.message ||
        String(error),

      code:
        error?.code || null,

      detail:
        error?.detail || null,

      hint:
        error?.hint || null
    });
  }
}

/* =========================================================
   WALLET API
========================================================= */

async function handleWallet(
  req,
  res
) {
  try {

    const token =
      getToken(req);

    if (!token) {
      return send(res, 401, {
        success: false,
        message:
          'Authentication required'
      });
    }

    const user =
      await getUserFromToken(token);

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

      wallet: {
        balance:
          Number(
            wallet.balance || 0
          ),

        total_earned:
          Number(
            wallet.total_earned || 0
          ),

        total_withdrawn:
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
   REGISTER
========================================================= */

async function handleRegister(
  body,
  res
) {
  try {

    const name =
      String(
        body.name || ''
      ).trim();

    const username =
      String(
        body.username || ''
      ).trim();

    const email =
      String(
        body.email || ''
      )
        .trim()
        .toLowerCase();

    const password =
      String(
        body.password || ''
      );

    const phone =
      String(
        body.phone || ''
      ).trim();

    const referralCode =
      String(
        body.referral_code ||
        body.referralCode ||
        ''
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

    const existing =
      await sql`
        SELECT id
        FROM users
        WHERE LOWER(email) =
              ${email}
           OR LOWER(username) =
              ${username.toLowerCase()}
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
      'user-' +
      crypto.randomUUID();

    /*
      IMPORTANT:
      Your database uses "password",
      NOT "password_hash".
    */

    await sql`
      INSERT INTO users (
        id,
        name,
        username,
        email,
        phone,
        password,
        role,
        coins,
        created_at
      )
      VALUES (
        ${userId},
        ${name},
        ${username},
        ${email},
        ${phone},
        ${password},
        'user',
        0,
        NOW()
      )
    `;

    /* -----------------------------------------
       WALLET
    ----------------------------------------- */

    const walletId =
      crypto.randomUUID();

    await sql`
      INSERT INTO wallets (
        id,
        user_id,
        balance,
        total_earned,
        total_withdrawn,
        created_at,
        updated_at
      )
      VALUES (
        ${walletId},
        ${userId},
        0,
        0,
        0,
        NOW(),
        NOW()
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

      message:
        'Unable to create account',

      error:
        error?.message ||
        String(error),

      code:
        error?.code || null
    });
  }
}

/* =========================================================
   LOGIN
========================================================= */

async function handleLogin(
  body,
  res
) {
  try {

    const email =
      String(
        body.email || ''
      )
        .trim()
        .toLowerCase();

    const password =
      String(
        body.password || ''
      );

    if (!email || !password) {

      return send(res, 400, {

        success: false,

        message:
          'Email and password are required'
      });
    }

    /*
      IMPORTANT:
      Your actual database column is:
      users.password
    */

    const users =
      await sql`
        SELECT *
        FROM users
        WHERE LOWER(email) =
              ${email}
          AND password =
              ${password}
        LIMIT 1
      `;

    if (users.length === 0) {

      return send(res, 401, {

        success: false,

        message:
          'Invalid email or password'
      });
    }

    const user =
      users[0];

    const token =
      crypto
        .randomBytes(32)
        .toString('hex');

    const sessionId =
      crypto.randomUUID();

    await sql`
      INSERT INTO admin_sessions (
        id,
        user_id,
        token,
        expires_at,
        created_at
      )
      VALUES (
        ${sessionId},
        ${String(user.id)},
        ${token},
        NOW() + INTERVAL '30 days',
        NOW()
      )
    `;

    const wallet =
      await getWallet(user.id);

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
        phone: user.phone || '',
        role: user.role || 'user',

        coins:
          Number(
            wallet?.balance ||
            user.coins ||
            0
          )
      },

      wallet: {
        balance:
          Number(
            wallet?.balance || 0
          ),

        total_earned:
          Number(
            wallet?.total_earned || 0
          ),

        total_withdrawn:
          Number(
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

      message:
        'Unable to login',

      error:
        error?.message ||
        String(error),

      code:
        error?.code || null,

      detail:
        error?.detail || null,

      hint:
        error?.hint || null
    });
  }
}

/* =========================================================
   DAILY BONUS
========================================================= */

async function handleDailyBonus(
  req,
  res
) {
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
   HEALTH
========================================================= */

async function handleHealth(res) {

  try {

    const result =
      await sql`
        SELECT NOW() AS database_time
      `;

    return send(res, 200, {

      ok: true,

      success: true,

      service:
        'EarnNest API',

      status:
        'running',

      database:
        'connected',

      databaseTime:
        result[0]?.database_time ||
        null
    });

  } catch (error) {

    return send(res, 500, {

      ok: false,

      success: false,

      service:
        'EarnNest API',

      status:
        'error',

      database:
        'disconnected',

      error:
        error.message
    });
  }
}

/* =========================================================
   MAIN API
========================================================= */

module.exports = async function handler(
  req,
  res
) {

  try {

    /* OPTIONS */

    if (
      req.method === 'OPTIONS'
    ) {

      return send(res, 200, {
        success: true
      });
    }

    /* HEALTH */

    if (
      req.url === '/api/health' ||
      req.url?.startsWith('/api/health?')
    ) {

      return handleHealth(res);
    }

    /* GET */

    if (
      req.method === 'GET'
    ) {

      return send(res, 200, {

        success: true,

        service:
          'EarnNest API',

        status:
          'running'
      });
    }

    /* ONLY POST */

    if (
      req.method !== 'POST'
    ) {

      return send(res, 405, {

        success: false,

        message:
          'Method not allowed'
      });
    }

    const body =
      await readBody(req);

    const action =
      String(
        body.action || ''
      )
        .trim()
        .toLowerCase();

    /* REGISTER */

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

    /* LOGIN */

    if (
      action === 'login' ||
      action === 'signin'
    ) {

      return handleLogin(
        body,
        res
      );
    }

    /* CLAIM REWARD */

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

    /* DAILY BONUS */

    if (
      action === 'daily_bonus'
    ) {

      return handleDailyBonus(
        req,
        res
      );
    }

    /* WALLET */

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
      If dashboard doesn't send action
      but sends reward information.
    */

    if (
      body.rewardType ||
      body.reward_type ||
      body.rewardId ||
      body.reward_id ||
      body.referenceKey ||
      body.reference_key
    ) {

      return handleClaimReward(
        body,
        req,
        res
      );
    }

    return send(res, 400, {

      success: false,

      message:
        'Unknown API action'
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
        error?.message ||
        String(error),

      code:
        error?.code || null
    });
  }
};
