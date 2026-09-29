'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  res.end(JSON.stringify(data));
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
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function getToken(req) {
  const auth = req.headers.authorization || '';

  if (auth.startsWith('Bearer ')) {
    return auth.substring(7).trim();
  }

  return '';
}

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
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
    LIMIT 1
  `;

  return rows[0] || null;
}

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
    WHERE user_id = ${String(userId)}
    LIMIT 1
  `;

  if (rows.length) {
    return rows[0];
  }

  // IMPORTANT:
  // wallets.id is BIGINT auto-increment.
  // Do NOT insert an ID here.
  const created = await sql`
    INSERT INTO wallets
      (user_id, balance, total_earned, total_withdrawn)
    VALUES
      (${String(userId)}, 0, 0, 0)
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

const TASKS = [
  {
    id: 'task1',
    title: 'Daily Check-in',
    description: 'Complete your daily check-in.',
    reward: 50,
    repeat: 'daily'
  },
  {
    id: 'task2',
    title: 'Follow Social Page',
    description: 'Follow the EarnNest social page.',
    reward: 100,
    repeat: 'once'
  },
  {
    id: 'task3',
    title: 'Read EarnNest Guide',
    description: 'Read the EarnNest guide.',
    reward: 75,
    repeat: 'once'
  },
  {
    id: 'task4',
    title: 'Complete Profile',
    description: 'Complete your profile information.',
    reward: 100,
    repeat: 'once'
  },
  {
    id: 'task5',
    title: 'Invite a Friend',
    description: 'Invite a friend to EarnNest.',
    reward: 150,
    repeat: 'once'
  },
  {
    id: 'task6',
    title: 'Daily Learning',
    description: 'Complete today's learning activity.',
    reward: 50,
    repeat: 'daily'
  },
  {
    id: 'task7',
    title: 'App Engagement',
    description: 'Complete the app engagement activity.',
    reward: 50,
    repeat: 'once'
  },
  {
    id: 'task8',
    title: 'Daily Activity',
    description: 'Complete today's activity.',
    reward: 75,
    repeat: 'daily'
  }
];

const SURVEYS = [
  {
    id: 'survey1',
    title: 'Quick Opinion',
    description: 'Answer a short opinion survey.',
    reward: 150
  },
  {
    id: 'survey2',
    title: 'User Experience',
    description: 'Tell us about your app experience.',
    reward: 200
  },
  {
    id: 'survey3',
    title: 'Rewards Survey',
    description: 'Share your rewards preferences.',
    reward: 250
  },
  {
    id: 'survey4',
    title: 'Shopping Survey',
    description: 'Answer questions about shopping.',
    reward: 300
  },
  {
    id: 'survey5',
    title: 'Technology Survey',
    description: 'Share your technology preferences.',
    reward: 250
  }
];

function normalizeTaskId(id) {
  const value = String(id || '').trim().toLowerCase();

  const aliases = {
    '1': 'task1',
    'task-1': 'task1',
    'daily-check-in': 'task1',

    '2': 'task2',
    'task-2': 'task2',

    '3': 'task3',
    'task-3': 'task3',

    '4': 'task4',
    'task-4': 'task4',

    '5': 'task5',
    'task-5': 'task5',

    '6': 'task6',
    'task-6': 'task6',

    '7': 'task7',
    'task-7': 'task7',

    '8': 'task8',
    'task-8': 'task8'
  };

  return aliases[value] || value;
}

function normalizeSurveyId(id) {
  const value = String(id || '').trim().toLowerCase();

  const aliases = {
    '1': 'survey1',
    'survey-1': 'survey1',

    '2': 'survey2',
    'survey-2': 'survey2',

    '3': 'survey3',
    'survey-3': 'survey3',

    '4': 'survey4',
    'survey-4': 'survey4',

    '5': 'survey5',
    'survey-5': 'survey5'
  };

  return aliases[value] || value;
}

async function handleHealth(res) {
  try {
    const result = await sql`
      SELECT NOW() AS database_time
    `;

    return send(res, 200, {
      success: true,
      service: 'EarnNest API',
      status: 'running',
      database: 'connected',
      databaseTime: result[0].database_time
    });
  } catch (error) {
    return send(res, 500, {
      success: false,
      service: 'EarnNest API',
      status: 'error',
      error: error.message
    });
  }
}

async function handleRegister(body, res) {
  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');

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

  const existing = await sql`
    SELECT id
    FROM users
    WHERE LOWER(email) = ${email}
       OR LOWER(username) = ${username.toLowerCase()}
    LIMIT 1
  `;

  if (existing.length) {
    return send(res, 409, {
      success: false,
      message: 'Email or username already exists.'
    });
  }

  const referralCode =
    'EN' +
    crypto.randomBytes(4).toString('hex').toUpperCase();

  const userId = crypto.randomUUID();

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
        ${referralCode},
        NULL
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

  // wallets.id is BIGINT auto-generated.
  await sql`
    INSERT INTO wallets
      (user_id, balance, total_earned, total_withdrawn)
    VALUES
      (${userId}, 0, 0, 0)
  `;

  return send(res, 201, {
    success: true,
    message: 'Account created successfully.',
    user: created[0]
  });
}

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

  if (String(dbUser.password || '') !== password) {
    return send(res, 401, {
      success: false,
      message: 'Invalid email/username or password.'
    });
  }

  const token = crypto.randomBytes(48).toString('hex');

  /*
   * IMPORTANT:
   * admin_sessions.id is BIGINT with auto-increment.
   * Therefore id is NOT supplied.
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

  const wallet = await getWallet(String(dbUser.id));

  // Keep users.coins synchronized with wallet balance.
  await sql`
    UPDATE users
    SET coins = ${Number(wallet.balance || 0)}
    WHERE id = ${String(dbUser.id)}
  `;

  const safeUser = {
    id: dbUser.id,
    name: dbUser.name,
    username: dbUser.username,
    email: dbUser.email,
    phone: dbUser.phone,
    role: dbUser.role,
    coins: Number(wallet.balance || 0),
    created_at: dbUser.created_at,
    referral_code: dbUser.referral_code,
    referred_by: dbUser.referred_by
  };

  return send(res, 200, {
    success: true,
    message: 'Login successful.',
    token,
    user: safeUser,
    wallet
  });
}

async function handleWallet(req, res) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Unauthorized.'
    });
  }

  const wallet = await getWallet(String(user.id));

  return send(res, 200, {
    success: true,
    wallet
  });
}

async function handleClaimReward(body, req, res) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Please login again.'
    });
  }

  const rewardType = String(
    body.rewardType || body.type || ''
  ).trim().toLowerCase();

  let rewardId = String(
    body.rewardId ||
    body.taskId ||
    body.surveyId ||
    body.id ||
    ''
  ).trim();

  if (rewardType === 'task') {
    rewardId = normalizeTaskId(rewardId);
  }

  if (rewardType === 'survey') {
    rewardId = normalizeSurveyId(rewardId);
  }

  let reward = null;

  if (rewardType === 'task') {
    reward = TASKS.find(item => item.id === rewardId);
  } else if (rewardType === 'survey') {
    reward = SURVEYS.find(item => item.id === rewardId);
  }

  if (!reward) {
    return send(res, 404, {
      success: false,
      message: 'Reward not found.'
    });
  }

  const referenceKey =
    `${rewardType}:${reward.id}`;

  const existing = await sql`
    SELECT id
    FROM reward_claims
    WHERE user_id = ${String(user.id)}
      AND reference_key = ${referenceKey}
    LIMIT 1
  `;

  if (existing.length) {
    return send(res, 409, {
      success: false,
      message: 'This reward has already been claimed.'
    });
  }

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
        ${crypto.randomUUID()},
        ${String(user.id)},
        ${rewardType},
        ${referenceKey},
        ${reward.title},
        ${Number(reward.reward)},
        NOW()
      )
  `;

  const wallet = await getWallet(String(user.id));

  const newBalance =
    Number(wallet.balance || 0) + Number(reward.reward);

  const newTotalEarned =
    Number(wallet.total_earned || 0) + Number(reward.reward);

  const updated = await sql`
    UPDATE wallets
    SET
      balance = ${newBalance},
      total_earned = ${newTotalEarned},
      updated_at = NOW()
    WHERE user_id = ${String(user.id)}
    RETURNING
      id,
      user_id,
      balance,
      total_earned,
      total_withdrawn,
      created_at,
      updated_at
  `;

  await sql`
    UPDATE users
    SET coins = ${newBalance}
    WHERE id = ${String(user.id)}
  `;

  return send(res, 200, {
    success: true,
    message: `${reward.reward} coins added successfully.`,
    reward: {
      id: reward.id,
      type: rewardType,
      title: reward.title,
      amount: reward.reward
    },
    wallet: updated[0]
  });
}

async function handleDailyBonus(req, res) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Please login again.'
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const referenceKey = `daily_bonus:${today}`;

  const existing = await sql`
    SELECT id
    FROM reward_claims
    WHERE user_id = ${String(user.id)}
      AND reference_key = ${referenceKey}
    LIMIT 1
  `;

  if (existing.length) {
    return send(res, 409, {
      success: false,
      message: 'Daily bonus already claimed today.'
    });
  }

  const amount = 50;

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
        ${crypto.randomUUID()},
        ${String(user.id)},
        'daily_bonus',
        ${referenceKey},
        'Daily Bonus',
        ${amount},
        NOW()
      )
  `;

  const wallet = await getWallet(String(user.id));

  const newBalance =
    Number(wallet.balance || 0) + amount;

  const newTotalEarned =
    Number(wallet.total_earned || 0) + amount;

  const updated = await sql`
    UPDATE wallets
    SET
      balance = ${newBalance},
      total_earned = ${newTotalEarned},
      updated_at = NOW()
    WHERE user_id = ${String(user.id)}
    RETURNING
      id,
      user_id,
      balance,
      total_earned,
      total_withdrawn,
      created_at,
      updated_at
  `;

  await sql`
    UPDATE users
    SET coins = ${newBalance}
    WHERE id = ${String(user.id)}
  `;

  return send(res, 200, {
    success: true,
    message: `${amount} coins added.`,
    wallet: updated[0]
  });
}

async function handleTasks(req, res) {
  return send(res, 200, {
    success: true,
    tasks: TASKS
  });
}

async function handleSurveys(req, res) {
  return send(res, 200, {
    success: true,
    surveys: SURVEYS
  });
}

async function handleMe(req, res) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Unauthorized.'
    });
  }

  const wallet = await getWallet(String(user.id));

  return send(res, 200, {
    success: true,
    user: {
      ...user,
      coins: Number(wallet.balance || 0)
    },
    wallet
  });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
    return res.end();
  }

  try {
    if (req.method === 'GET') {
      const url = new URL(
        req.url,
        `https://${req.headers.host || 'localhost'}`
      );

      const path = url.pathname;

      if (path === '/api/health') {
        return handleHealth(res);
      }

      if (path === '/api/tasks') {
        return handleTasks(req, res);
      }

      if (path === '/api/surveys') {
        return handleSurveys(req, res);
      }

      if (path === '/api/me') {
        return handleMe(req, res);
      }

      if (path === '/api/wallet') {
        return handleWallet(req, res);
      }

      return send(res, 200, {
        success: true,
        service: 'EarnNest API',
        status: 'running'
      });
    }

    if (req.method !== 'POST') {
      return send(res, 405, {
        success: false,
        message: 'Method not allowed.'
      });
    }

    const body = await readBody(req);
    const action = String(body.action || '').trim().toLowerCase();

    switch (action) {
      case 'register':
      case 'signup':
      case 'create_account':
        return handleRegister(body, res);

      case 'login':
        return handleLogin(body, res);

      case 'claim_reward':
      case 'complete_task':
      case 'complete_survey':
        return handleClaimReward(body, req, res);

      case 'daily_bonus':
      case 'claim_daily_bonus':
        return handleDailyBonus(req, res);

      case 'wallet':
      case 'get_wallet':
        return handleWallet(req, res);

      default:
        return send(res, 400, {
          success: false,
          message: 'Unknown action.',
          action
        });
    }
  } catch (error) {
    console.error('EarnNest API Error:', error);

    return send(res, 500, {
      success: false,
      message: 'Server error.',
      error: error.message,
      code: error.code || null,
      detail: error.detail || null
    });
  }
}

module.exports = handler;
