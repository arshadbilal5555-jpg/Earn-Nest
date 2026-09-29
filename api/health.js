'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);


/* =========================================================
   RESPONSE
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

  res.end(JSON.stringify(data));
}


/* =========================================================
   BODY
========================================================= */

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
        reject(new Error('Invalid JSON request.'));
      }
    });

    req.on('error', reject);
  });
}


/* =========================================================
   TOKEN
========================================================= */

function getToken(req) {
  const auth = req.headers.authorization || '';

  if (!auth.startsWith('Bearer ')) {
    return null;
  }

  return auth.substring(7).trim();
}


/* =========================================================
   USER FROM TOKEN
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
    INNER JOIN users u
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
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  if (rows[0]) {
    return rows[0];
  }

  const walletId = crypto.randomUUID();

  const created = await sql`
    INSERT INTO wallets
    (
      id,
      user_id,
      balance,
      total_earned,
      total_withdrawn,
      created_at,
      updated_at
    )
    VALUES
    (
      ${walletId},
      ${userId},
      0,
      0,
      0,
      NOW(),
      NOW()
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
   TASKS
========================================================= */

const TASKS = {

  task1: {
    id: 'task1',
    title: 'Daily Check-in',
    description: 'Complete your daily check-in.',
    amount: 50,
    type: 'daily'
  },

  task2: {
    id: 'task2',
    title: 'Follow Social Page',
    description: 'Follow the EarnNest social page.',
    amount: 100,
    type: 'once'
  },

  task3: {
    id: 'task3',
    title: 'Read EarnNest Guide',
    description: 'Read the EarnNest earning guide.',
    amount: 75,
    type: 'once'
  },

  task4: {
    id: 'task4',
    title: 'Complete Profile',
    description: 'Complete your EarnNest profile.',
    amount: 100,
    type: 'once'
  },

  task5: {
    id: 'task5',
    title: 'Invite a Friend',
    description: 'Invite a friend to EarnNest.',
    amount: 150,
    type: 'once'
  },

  task6: {
    id: 'task6',
    title: 'Daily Learning',
    description: 'Complete today's learning activity.',
    amount: 50,
    type: 'daily'
  },

  task7: {
    id: 'task7',
    title: 'App Engagement',
    description: 'Complete the app engagement activity.',
    amount: 50,
    type: 'once'
  },

  task8: {
    id: 'task8',
    title: 'Daily Activity',
    description: 'Complete today's activity.',
    amount: 75,
    type: 'daily'
  }

};


/* =========================================================
   SURVEYS
========================================================= */

const SURVEYS = {

  survey1: {
    id: 'survey1',
    title: 'Quick Opinion',
    description: 'Answer a short opinion survey.',
    amount: 150,
    type: 'once'
  },

  survey2: {
    id: 'survey2',
    title: 'User Experience',
    description: 'Tell us about your app experience.',
    amount: 200,
    type: 'once'
  },

  survey3: {
    id: 'survey3',
    title: 'Rewards Survey',
    description: 'Share your opinion about rewards.',
    amount: 250,
    type: 'once'
  },

  survey4: {
    id: 'survey4',
    title: 'Shopping Survey',
    description: 'Answer questions about shopping.',
    amount: 300,
    type: 'once'
  },

  survey5: {
    id: 'survey5',
    title: 'Technology Survey',
    description: 'Answer questions about technology.',
    amount: 250,
    type: 'once'
  }

};


/* =========================================================
   COMPATIBILITY IDs
========================================================= */

const COMPATIBILITY = {

  'daily-check-in': 'task1',

  'complete-profile': 'task4',

  'app-visit': 'task7',

  'weekly-activity': 'task8',

  'quick-opinion': 'survey1',

  'shopping-survey': 'survey4',

  'technology-survey': 'survey5'

};


function normalizeRewardId(id) {

  if (!id) {
    return null;
  }

  const value = String(id).trim();

  if (TASKS[value]) {
    return value;
  }

  if (SURVEYS[value]) {
    return value;
  }

  if (COMPATIBILITY[value]) {
    return COMPATIBILITY[value];
  }

  return null;
}


/* =========================================================
   REWARD CLAIM
========================================================= */

async function handleClaimReward(req, res, body) {

  try {

    const user = await getUserFromToken(req);

    if (!user) {

      return send(res, 401, {
        success: false,
        message: 'Please login again.'
      });

    }


    const rewardType =
      body.rewardType ||
      body.reward_type ||
      body.type ||
      'task';


    const rawId =
      body.rewardId ||
      body.reward_id ||
      body.referenceKey ||
      body.reference_key ||
      body.taskId ||
      body.task_id ||
      body.surveyId ||
      body.survey_id;


    const rewardId =
      normalizeRewardId(rawId);


    if (!rewardId) {

      return send(res, 400, {
        success: false,
        message: 'Invalid reward ID.'
      });

    }


    let reward = null;


    if (TASKS[rewardId]) {

      reward = TASKS[rewardId];

    } else if (SURVEYS[rewardId]) {

      reward = SURVEYS[rewardId];

    }


    if (!reward) {

      return send(res, 404, {
        success: false,
        message: 'Reward not found.'
      });

    }


    /*
      Daily rewards use today's date as reference.
      One-time rewards use the reward ID.
    */

    let referenceKey = reward.id;


    if (reward.type === 'daily') {

      const dateRows = await sql`
        SELECT CURRENT_DATE::text AS today
      `;

      const today = dateRows[0].today;

      referenceKey =
        `${reward.id}:${today}`;
    }


    /*
      Check duplicate claim
    */

    const existing = await sql`
      SELECT id
      FROM reward_claims
      WHERE user_id = ${user.id}
        AND reference_key = ${referenceKey}
      LIMIT 1
    `;


    if (existing.length > 0) {

      return send(res, 409, {
        success: false,
        message: 'This reward has already been claimed.'
      });

    }


    /*
      Make sure wallet exists
    */

    await getWallet(user.id);


    /*
      Create claim
    */

    const claimId = crypto.randomUUID();


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
        ${user.id},
        ${rewardType},
        ${referenceKey},
        ${reward.title},
        ${reward.amount},
        NOW()
      )
    `;


    /*
      Update wallet
    */

    const walletRows = await sql`
      UPDATE wallets
      SET
        balance = COALESCE(balance, 0) + ${reward.amount},
        total_earned = COALESCE(total_earned, 0) + ${reward.amount},
        updated_at = NOW()
      WHERE user_id = ${user.id}
      RETURNING
        balance,
        total_earned,
        total_withdrawn
    `;


    if (!walletRows.length) {

      throw new Error(
        'Wallet could not be updated.'
      );

    }


    const wallet = walletRows[0];


    /*
      Keep users.coins synchronized
    */

    await sql`
      UPDATE users
      SET coins = ${wallet.balance}
      WHERE id = ${user.id}
    `;


    return send(res, 200, {

      success: true,

      message:
        `${reward.title} completed. ${reward.amount} coins added.`,

      reward: {
        id: reward.id,
        title: reward.title,
        amount: reward.amount
      },

      wallet: wallet

    });


  } catch (error) {

    console.error(
      'Reward claim error:',
      error
    );

    return send(res, 500, {

      success: false,

      message:
        error.message ||
        'Unable to process reward.'

    });

  }

}


/* =========================================================
   WALLET
========================================================= */

async function handleWallet(req, res) {

  try {

    const user =
      await getUserFromToken(req);


    if (!user) {

      return send(res, 401, {
        success: false,
        message: 'Please login again.'
      });

    }


    const wallet =
      await getWallet(user.id);


    return send(res, 200, {

      success: true,

      wallet: wallet,

      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        coins: wallet.balance
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
        error.message ||
        'Unable to load wallet.'

    });

  }

}


/* =========================================================
   REGISTER
========================================================= */

async function handleRegister(req, res, body) {

  try {

    const name =
      String(body.name || '').trim();


    const username =
      String(body.username || '').trim();


    const email =
      String(body.email || '')
        .trim()
        .toLowerCase();


    const phone =
      String(body.phone || '').trim();


    const password =
      String(body.password || '');


    const confirmPassword =
      String(
        body.confirmPassword ||
        body.confirm_password ||
        ''
      );


    const referralCode =
      String(
        body.referralCode ||
        body.referral_code ||
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
          'Please fill all required fields.'

      });

    }


    if (password.length < 6) {

      return send(res, 400, {

        success: false,

        message:
          'Password must be at least 6 characters.'

      });

    }


    if (
      confirmPassword &&
      password !== confirmPassword
    ) {

      return send(res, 400, {

        success: false,

        message:
          'Passwords do not match.'

      });

    }


    /*
      Check email
    */

    const emailExists = await sql`
      SELECT id
      FROM users
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;


    if (emailExists.length > 0) {

      return send(res, 409, {

        success: false,

        message:
          'An account with this email already exists.'

      });

    }


    /*
      Check username
    */

    const usernameExists = await sql`
      SELECT id
      FROM users
      WHERE LOWER(username) =
            LOWER(${username})
      LIMIT 1
    `;


    if (usernameExists.length > 0) {

      return send(res, 409, {

        success: false,

        message:
          'This username is already taken.'

      });

    }


    /*
      Referral
    */

    let referredBy = null;


    if (referralCode) {

      const referrer = await sql`
        SELECT id
        FROM users
        WHERE referral_code = ${referralCode}
        LIMIT 1
      `;


      if (referrer.length > 0) {

        referredBy =
          referrer[0].id;

      }

    }


    /*
      Create user
    */

    const userId =
      crypto.randomUUID();


    const newReferralCode =
      'EN' +
      crypto
        .randomBytes(4)
        .toString('hex')
        .toUpperCase();


    const userRows = await sql`
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


    const user =
      userRows[0];


    /*
      Create wallet
    */

    const walletId =
      crypto.randomUUID();


    await sql`
      INSERT INTO wallets
      (
        id,
        user_id,
        balance,
        total_earned,
        total_withdrawn,
        created_at,
        updated_at
      )
      VALUES
      (
        ${walletId},
        ${user.id},
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
        'Account created successfully.',

      user: user

    });


  } catch (error) {

    console.error(
      'Registration error:',
      error
    );


    return send(res, 500, {

      success: false,

      message:
        error.message ||
        'Unable to create account.'

    });

  }

}


/* =========================================================
   LOGIN
========================================================= */

async function handleLogin(req, res, body) {

  try {

    const login =
      String(
        body.login ||
        body.email ||
        body.username ||
        ''
      )
        .trim()
        .toLowerCase();


    const password =
      String(body.password || '');


    if (!login || !password) {

      return send(res, 400, {

        success: false,

        message:
          'Please enter your email and password.'

      });

    }


    /*
      Search by email OR username
    */

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
      WHERE
        LOWER(email) = ${login}
        OR
        LOWER(username) = ${login}
      LIMIT 1
    `;


    if (!users.length) {

      return send(res, 401, {

        success: false,

        message:
          'Invalid email/username or password.'

      });

    }


    const dbUser =
      users[0];


    /*
      Actual database uses "password"
    */

    if (
      String(dbUser.password) !==
      password
    ) {

      return send(res, 401, {

        success: false,

        message:
          'Invalid email/username or password.'

      });

    }


    /*
      Create session token
    */

    const token =
      crypto.randomBytes(48).toString('hex');


    /*
      admin_sessions table requires:
      id
      user_id
      token
      expires_at
      created_at
    */

    const sessionId =
      crypto.randomUUID();


    await sql`
      INSERT INTO admin_sessions
      (
        id,
        user_id,
        token,
        expires_at,
        created_at
      )
      VALUES
      (
        ${sessionId},
        ${dbUser.id},
        ${token},
        NOW() + INTERVAL '30 days',
        NOW()
      )
    `;


    /*
      Make sure wallet exists
    */

    const wallet =
      await getWallet(dbUser.id);


    /*
      Keep coins synchronized
    */

    if (
      Number(dbUser.coins || 0) !==
      Number(wallet.balance || 0)
    ) {

      await sql`
        UPDATE users
        SET coins = ${wallet.balance}
        WHERE id = ${dbUser.id}
      `;

    }


    /*
      Never send password to frontend
    */

    const user = {

      id: dbUser.id,

      name: dbUser.name,

      username: dbUser.username,

      email: dbUser.email,

      phone: dbUser.phone,

      role: dbUser.role,

      coins: wallet.balance,

      created_at: dbUser.created_at,

      referral_code:
        dbUser.referral_code,

      referred_by:
        dbUser.referred_by

    };


    return send(res, 200, {

      success: true,

      message:
        'Login successful.',

      token: token,

      user: user,

      wallet: wallet

    });


  } catch (error) {

    console.error(
      'Login error:',
      error
    );


    return send(res, 500, {

      success: false,

      message:
        error.message ||
        'Unable to login.'

    });

  }

}


/* =========================================================
   DAILY BONUS
========================================================= */

async function handleDailyBonus(req, res) {

  try {

    const user =
      await getUserFromToken(req);


    if (!user) {

      return send(res, 401, {

        success: false,

        message:
          'Please login again.'

      });

    }


    const referenceKey =
      `daily-bonus:${new Date().toISOString().slice(0,10)}`;


    const existing = await sql`
      SELECT id
      FROM reward_claims
      WHERE user_id = ${user.id}
        AND reference_key = ${referenceKey}
      LIMIT 1
    `;


    if (existing.length > 0) {

      return send(res, 409, {

        success: false,

        message:
          'Daily bonus already claimed today.'

      });

    }


    const amount = 50;

    const claimId =
      crypto.randomUUID();


    await getWallet(user.id);


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
        ${user.id},
        'daily_bonus',
        ${referenceKey},
        'Daily Bonus',
        ${amount},
        NOW()
      )
    `;


    const walletRows = await sql`
      UPDATE wallets
      SET
        balance =
          COALESCE(balance,0) + ${amount},

        total_earned =
          COALESCE(total_earned,0) + ${amount},

        updated_at = NOW()

      WHERE user_id = ${user.id}

      RETURNING
        balance,
        total_earned,
        total_withdrawn
    `;


    const wallet =
      walletRows[0];


    await sql`
      UPDATE users
      SET coins = ${wallet.balance}
      WHERE id = ${user.id}
    `;


    return send(res, 200, {

      success: true,

      message:
        'Daily bonus claimed successfully.',

      amount: amount,

      wallet: wallet

    });


  } catch (error) {

    console.error(
      'Daily bonus error:',
      error
    );


    return send(res, 500, {

      success: false,

      message:
        error.message ||
        'Unable to claim daily bonus.'

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
        rows[0].database_time

    });


  } catch (error) {

    console.error(
      'Health error:',
      error
    );


    return send(res, 500, {

      ok: false,

      success: false,

      service: 'EarnNest API',

      status: 'error',

      database: 'error',

      message:
        error.message

    });

  }

}


/* =========================================================
   MAIN API
========================================================= */

module.exports = async function handler(req, res) {

  /*
    CORS
  */

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


  /*
    OPTIONS
  */

  if (req.method === 'OPTIONS') {

    res.statusCode = 204;

    res.end();

    return;

  }


  /*
    Health
  */

  if (
    req.method === 'GET' &&
    (
      req.url === '/api' ||
      req.url === '/api/' ||
      req.url.startsWith('/api/health')
    )
  ) {

    return handleHealth(req, res);

  }


  /*
    GET wallet
  */

  if (
    req.method === 'GET' &&
    req.url.startsWith('/api/wallet')
  ) {

    return handleWallet(req, res);

  }


  /*
    Only POST below
  */

  if (req.method !== 'POST') {

    return send(res, 405, {

      success: false,

      message:
        'Method not allowed.'

    });

  }


  try {

    const body =
      await readBody(req);


    const action =
      String(body.action || '')
        .trim()
        .toLowerCase();


    switch (action) {

      case 'register':

        return handleRegister(
          req,
          res,
          body
        );


      case 'login':

        return handleLogin(
          req,
          res,
          body
        );


      case 'claim_reward':

      case 'claim-reward':

      case 'claim_reward_task':

      case 'complete_task':

      case 'complete_survey':

        return handleClaimReward(
          req,
          res,
          body
        );


      case 'daily_bonus':

      case 'claim_daily_bonus':

        return handleDailyBonus(
          req,
          res
        );


      case 'wallet':

      case 'get_wallet':

        return handleWallet(
          req,
          res
        );


      case 'health':

        return handleHealth(
          req,
          res
        );


      default:

        return send(res, 400, {

          success: false,

          message:
            'Unknown API action.'

        });

    }

  } catch (error) {

    console.error(
      'API error:',
      error
    );


    return send(res, 500, {

      success: false,

      message:
        error.message ||
        'Internal server error.'

    });

  }

};
