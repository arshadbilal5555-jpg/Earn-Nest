'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);


/* =========================
   RESPONSE
========================= */

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
    'POST,OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  return res.end(
    JSON.stringify(data)
  );
}


/* =========================
   HELPERS
========================= */

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
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
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}


/* =========================
   REFERRAL
========================= */

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


/* =========================
   SESSION
========================= */

async function getUserFromToken(token) {
  if (!token) {
    return null;
  }

  const rows = await sql`
    SELECT
      u.*
    FROM admin_sessions s
    INNER JOIN users u
      ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
    LIMIT 1
  `;

  return rows[0] || null;
}


/* =========================
   WALLET
========================= */

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

    rows = await sql`
      SELECT *
      FROM wallets
      WHERE user_id = ${userId}
      LIMIT 1
    `;
  }

  return rows[0] || {
    balance: 0,
    total_earned: 0,
    total_withdrawn: 0
  };
}


/* =========================
   REGISTER
========================= */

async function handleRegister(body, res) {
  const name = clean(body.name);
  const username = clean(body.username).toLowerCase();
  const userEmail = normalizeEmail(body.email);
  const phone = clean(body.phone);

  const password =
    String(body.password || '');

  const confirmPassword =
    String(
      body.confirmPassword ||
      body.confirm ||
      ''
    );

  const referralCode =
    clean(
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
      SELECT id, username, email
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
        WHERE UPPER(referral_code) =
              ${referralCode}
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


    const userId =
      `user-${crypto.randomUUID()}`;


    const newReferralCode =
      await createUniqueReferralCode(
        username
      );


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
    `;


    if (referrer) {

      const bonus = 100;


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

        WHERE user_id = ${referrer.id}
      `;


      await sql`
        UPDATE users
        SET
          coins =
            COALESCE(coins, 0) + ${bonus}
        WHERE id = ${referrer.id}
      `;
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


/* =========================
   LOGIN
========================= */

async function handleLogin(body, res) {

  const login =
    normalizeEmail(
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


    const token =
      crypto.randomUUID();


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

        coins: balance,
        balance: balance,

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


/* =========================
   REWARD CLAIM TABLE
========================= */

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
}


/* =========================
   REWARD DEFINITIONS
========================= */

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
    coins: 100
  },

  task3: {
    title: 'Read EarnNest Guide',
    description:
      'Read the earning guide and learn how EarnNest works.',
    coins: 75
  },

  task4: {
    title: 'Complete Profile',
    description:
      'Make sure your profile information is complete.',
    coins: 100
  },

  task5: {
    title: 'Invite a Friend',
    description:
      'Invite a new user using your referral code.',
    coins: 150
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
    coins: 50
  },

  task8: {
    title: 'Daily Activity',
    description:
      'Complete today’s EarnNest activity.',
    coins: 75,
    daily: true
  }
};


const SURVEYS = {

  survey1: {
    title: 'Quick Opinion Survey',
    description:
      'Answer 3 quick questions.',
    coins: 150
  },

  survey2: {
    title: 'User Experience Survey',
    description:
      'Tell us about your EarnNest experience.',
    coins: 200
  },

  survey3: {
    title: 'Rewards Survey',
    description:
      'Answer a short survey about reward preferences.',
    coins: 250
  },

  survey4: {
    title: 'Shopping Survey',
    description:
      'Answer questions about shopping habits.',
    coins: 300
  },

  survey5: {
    title: 'Technology Survey',
    description:
      'Complete a short technology opinion survey.',
    coins: 250
  }
};


/* =========================
   CLAIM REWARD
========================= */

async function handleClaimReward(body, req, res) {

  const token =
    clean(
      req.headers.authorization || ''
    ).replace(
      /^Bearer\s+/i,
      ''
    );


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
      clean(body.rewardId);


    if (
      !rewardType ||
      !rewardId
    ) {
      return send(res, 400, {
        success: false,
        message:
          'Reward information is missing'
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
          'Reward not found'
      });
    }


    await ensureRewardTable();


    /*
      Daily rewards get a date-specific ID.
      This allows them once per day.
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
      Check whether already claimed.
    */

    const alreadyClaimed =
      await sql`
        SELECT id
        FROM reward_claims
        WHERE user_id = ${user.id}
          AND reward_type = ${rewardType}
          AND reward_id = ${claimId}
        LIMIT 1
      `;


    if (alreadyClaimed.length) {

      return send(res, 409, {
        success: false,
        message:
          reward.daily
            ? 'This daily reward has already been claimed today.'
            : 'This reward has already been claimed.'
      });
    }


    /*
      Record claim first.
      UNIQUE constraint prevents duplicate claims.
    */

    try {

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
          ${user.id},
          ${rewardType},
          ${claimId},
          ${reward.coins},
          NOW()
        )
      `;

    } catch (claimError) {

      if (
        String(claimError.message)
          .toLowerCase()
          .includes('unique')
      ) {
        return send(res, 409, {
          success: false,
          message:
            'This reward has already been claimed.'
        });
      }

      throw claimError;
    }


    /*
      Add reward to wallet.
    */

    await getWallet(user.id);


    await sql`
      UPDATE wallets
      SET
        balance =
          COALESCE(balance, 0)
          + ${reward.coins},

        total_earned =
          COALESCE(total_earned, 0)
          + ${reward.coins}

      WHERE user_id = ${user.id}
    `;


    /*
      Keep users.coins synchronized.
    */

    await sql`
      UPDATE users
      SET
        coins =
          COALESCE(coins, 0)
          + ${reward.coins}

      WHERE id = ${user.id}
    `;


    const wallet =
      await getWallet(user.id);


    const balance =
      Number(wallet.balance || 0);


    const totalEarned =
      Number(wallet.total_earned || 0);


    return send(res, 200, {

      success: true,

      message:
        `${reward.coins} coins added successfully.`,

      reward: {
        type: rewardType,
        id: rewardId,
        coins: reward.coins
      },

      wallet: {
        balance,
        coins: balance,
        totalEarned
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
        error.message
    });
  }
}


/* =========================
   WALLET INFO
========================= */

async function handleWallet(req, res) {

  const token =
    clean(
      req.headers.authorization || ''
    ).replace(
      /^Bearer\s+/i,
      ''
    );


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


/* =========================
   DAILY BONUS
========================= */

async function handleDailyBonus(req, res) {

  const token =
    clean(
      req.headers.authorization || ''
    ).replace(
      /^Bearer\s+/i,
      ''
    );


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
        WHERE user_id = ${user.id}
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
        ${user.id},
        'daily_bonus',
        ${claimId},
        ${bonus},
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

      WHERE user_id = ${user.id}
    `;


    await sql`
      UPDATE users
      SET
        coins =
          COALESCE(coins, 0) + ${bonus}

      WHERE id = ${user.id}
    `;


    const wallet =
      await getWallet(user.id);


    return send(res, 200, {

      success: true,

      message:
        'Daily bonus added successfully.',

      wallet: {

        balance:
          Number(wallet.balance || 0),

        coins:
          Number(wallet.balance || 0),

        totalEarned:
          Number(
            wallet.total_earned || 0
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


/* =========================
   MAIN API
========================= */

module.exports = async function(req, res) {

  if (req.method === 'OPTIONS') {

    res.statusCode = 204;

    res.setHeader(
      'Access-Control-Allow-Origin',
      '*'
    );

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
      message:
        'Method not allowed. Use POST.'
    });
  }


  try {

    const body =
      await readBody(req);


    if (
      body.action === 'register'
    ) {

      return await handleRegister(
        body,
        res
      );
    }


    if (
      body.action === 'login' ||
      !body.action
    ) {

      return await handleLogin(
        body,
        res
      );
    }


    if (
      body.action === 'claim_reward'
    ) {

      return await handleClaimReward(
        body,
        req,
        res
      );
    }


    if (
      body.action === 'wallet'
    ) {

      return await handleWallet(
        req,
        res
      );
    }


    if (
      body.action === 'daily_bonus'
    ) {

      return await handleDailyBonus(
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
