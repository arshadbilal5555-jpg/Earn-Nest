'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

/* =========================================================
   CONFIG
========================================================= */

const DAILY_BONUS_AMOUNT = 50;
const REFERRER_REWARD = 100;
const NEW_USER_REFERRAL_BONUS = 50;
const MIN_WITHDRAWAL = 1000;

/* =========================================================
   REWARD CATALOG
========================================================= */

const TASK_REWARDS = {
  task1: 50,
  task2: 100,
  task3: 75,
  task4: 100,
  task5: 150,
  task6: 50,
  task7: 50,
  task8: 75
};

const SURVEY_REWARDS = {
  survey1: 150,
  survey2: 200,
  survey3: 250,
  survey4: 300,
  survey5: 250
};

/* =========================================================
   RESPONSE HELPER
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
        reject(error);
      }
    });

    req.on('error', reject);
  });
}

/* =========================================================
   ID / TOKEN HELPERS
========================================================= */

function makeId() {
  return crypto.randomBytes(16).toString('hex');
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function makeReferralCode(username) {
  const clean = String(username || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toUpperCase();

  const random = crypto.randomBytes(3).toString('hex').toUpperCase();

  return `${clean || 'USER'}${random}`;
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

  if (rows.length) {
    return rows[0];
  }

  const created = await sql`
    INSERT INTO wallets (
      user_id,
      balance,
      total_earned,
      total_withdrawn
    )
    VALUES (
      ${userId},
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

function walletResponse(wallet) {
  return {
    balance: Number(wallet.balance || 0),
    totalEarned: Number(wallet.total_earned || 0),
    totalWithdrawn: Number(wallet.total_withdrawn || 0)
  };
}

/* =========================================================
   ADD COINS
========================================================= */

async function addCoins(userId, amount) {
  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Invalid coin amount');
  }

  await sql`
    UPDATE users
    SET coins = COALESCE(coins, 0) + ${value}
    WHERE id = ${userId}
  `;

  const wallet = await getWallet(userId);

  const updated = await sql`
    UPDATE wallets
    SET
      balance = COALESCE(balance, 0) + ${value},
      total_earned = COALESCE(total_earned, 0) + ${value},
      updated_at = NOW()
    WHERE user_id = ${userId}
    RETURNING
      id,
      user_id,
      balance,
      total_earned,
      total_withdrawn,
      created_at,
      updated_at
  `;

  return updated[0] || wallet;
}

/* =========================================================
   CURRENT USER FROM TOKEN
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
      u.referred_by,
      u.status
    FROM admin_sessions s
    INNER JOIN users u
      ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
    LIMIT 1
  `;

  if (!rows.length) {
    return null;
  }

  const user = rows[0];

  /*
    Blocked / disabled users cannot use an old session.
  */
  if (user.status !== 'active') {
    return null;
  }

  return user;
}

/* =========================================================
   LOGIN
========================================================= */

async function handleLogin(req, res, body) {
  const login = String(
    body.login ||
    body.email ||
    body.username ||
    ''
  ).trim();

  const password = String(body.password || '');

  if (!login || !password) {
    return send(res, 400, {
      success: false,
      message: 'Login and password are required'
    });
  }

  try {
    const rows = await sql`
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
        referred_by,
        status
      FROM users
      WHERE LOWER(email) = LOWER(${login})
         OR LOWER(username) = LOWER(${login})
      LIMIT 1
    `;

    if (!rows.length) {
      return send(res, 401, {
        success: false,
        message: 'Invalid login details'
      });
    }

    const user = rows[0];

    if (user.password !== password) {
      return send(res, 401, {
        success: false,
        message: 'Invalid login details'
      });
    }

    if (user.status === 'blocked') {
      return send(res, 403, {
        success: false,
        message: 'Your account has been blocked. Please contact support.'
      });
    }

    if (user.status === 'disabled') {
      return send(res, 403, {
        success: false,
        message: 'Your account has been disabled. Please contact support.'
      });
    }

    if (user.status !== 'active') {
      return send(res, 403, {
        success: false,
        message: 'Your account is not active.'
      });
    }

    const token = makeToken();

    await sql`
      INSERT INTO admin_sessions (
        user_id,
        token,
        expires_at
      )
      VALUES (
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
        coins: Number(user.coins || 0),
        created_at: user.created_at,
        referral_code: user.referral_code,
        referred_by: user.referred_by,
        status: user.status
      },
      wallet: walletResponse(wallet)
    });

  } catch (error) {
    console.error('LOGIN ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Server error'
    });
  }
}

/* =========================================================
   REGISTER
========================================================= */

async function handleRegister(req, res, body) {
  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const confirmPassword = String(
    body.confirmPassword ||
    body.confirm ||
    ''
  );

  const referralCode = String(
    body.referralCode ||
    body.referral ||
    ''
  ).trim();

  if (!name || !username || !email || !password) {
    return send(res, 400, {
      success: false,
      message: 'Please fill all required fields'
    });
  }

  if (password.length < 6) {
    return send(res, 400, {
      success: false,
      message: 'Password must be at least 6 characters'
    });
  }

  if (
    confirmPassword &&
    password !== confirmPassword
  ) {
    return send(res, 400, {
      success: false,
      message: 'Passwords do not match'
    });
  }

  try {
    const duplicate = await sql`
      SELECT id, email, username
      FROM users
      WHERE LOWER(email) = LOWER(${email})
         OR LOWER(username) = LOWER(${username})
      LIMIT 1
    `;

    if (duplicate.length) {
      if (
        String(duplicate[0].email).toLowerCase() ===
        email.toLowerCase()
      ) {
        return send(res, 409, {
          success: false,
          message: 'Email already registered'
        });
      }

      return send(res, 409, {
        success: false,
        message: 'Username already taken'
      });
    }

    let referredBy = null;

    if (referralCode) {
      const refRows = await sql`
        SELECT id
        FROM users
        WHERE LOWER(referral_code) = LOWER(${referralCode})
        LIMIT 1
      `;

      if (refRows.length) {
        referredBy = refRows[0].id;
      }
    }

    const userId = makeId();

    let newReferralCode = makeReferralCode(username);

    /*
      Make sure referral code is unique.
    */
    for (let i = 0; i < 5; i++) {
      const existing = await sql`
        SELECT id
        FROM users
        WHERE referral_code = ${newReferralCode}
        LIMIT 1
      `;

      if (!existing.length) {
        break;
      }

      newReferralCode = makeReferralCode(username);
    }

    const inserted = await sql`
      INSERT INTO users (
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
        status
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
        ${newReferralCode},
        ${referredBy},
        'active'
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
        referred_by,
        status
    `;

    const user = inserted[0];

    await getWallet(user.id);

    /*
      Referral reward.
    */
    if (referredBy && referredBy !== user.id) {
      try {
        const claimKey = `signup_${user.id}`;

        const claim = await sql`
          SELECT id
          FROM reward_claims
          WHERE user_id = ${referredBy}
            AND reward_type = 'referral'
            AND reference_key = ${claimKey}
          LIMIT 1
        `;

        if (!claim.length) {
          await addCoins(
            referredBy,
            REFERRER_REWARD
          );

          await sql`
            INSERT INTO reward_claims (
              id,
              user_id,
              reward_type,
              reference_key,
              title,
              amount
            )
            VALUES (
              ${makeId()},
              ${referredBy},
              'referral',
              ${claimKey},
              'Referral Reward',
              ${REFERRER_REWARD}
            )
          `;
        }
      } catch (refError) {
        console.error(
          'REFERRAL REWARD ERROR:',
          refError
        );
      }

      try {
        await addCoins(
          user.id,
          NEW_USER_REFERRAL_BONUS
        );

        await sql`
          INSERT INTO reward_claims (
            id,
            user_id,
            reward_type,
            reference_key,
            title,
            amount
          )
          VALUES (
            ${makeId()},
            ${user.id},
            'referral_bonus',
            ${`welcome_${user.id}`},
            'Referral Welcome Bonus',
            ${NEW_USER_REFERRAL_BONUS}
          )
        `;
      } catch (bonusError) {
        console.error(
          'NEW USER BONUS ERROR:',
          bonusError
        );
      }
    }

    const token = makeToken();

    await sql`
      INSERT INTO admin_sessions (
        user_id,
        token,
        expires_at
      )
      VALUES (
        ${user.id},
        ${token},
        NOW() + INTERVAL '30 days'
      )
    `;

    const wallet = await getWallet(user.id);

    return send(res, 201, {
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        ...user,
        coins: Number(user.coins || 0)
      },
      wallet: walletResponse(wallet)
    });

  } catch (error) {
    console.error('REGISTER ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Account creation failed',
      error: error.message
    });
  }
}

/* =========================================================
   DASHBOARD
========================================================= */

async function handleDashboard(req, res) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Unauthorized'
    });
  }

  const wallet = await getWallet(user.id);

  return send(res, 200, {
    success: true,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role,
      coins: Number(user.coins || 0),
      referral_code: user.referral_code,
      status: user.status
    },
    wallet: walletResponse(wallet)
  });
}

/* =========================================================
   WALLET
========================================================= */

async function handleWallet(req, res) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Unauthorized'
    });
  }

  const wallet = await getWallet(user.id);

  return send(res, 200, {
    success: true,
    wallet: walletResponse(wallet),
    coins: Number(user.coins || 0)
  });
}

/* =========================================================
   CLAIM REWARD
========================================================= */

async function handleClaimReward(req, res, body) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Unauthorized'
    });
  }

  const rewardType = String(
    body.rewardType || ''
  ).trim().toLowerCase();

  const rewardId = String(
    body.rewardId || ''
  ).trim();

  if (!rewardType || !rewardId) {
    return send(res, 400, {
      success: false,
      message: 'Reward information is required'
    });
  }

  let amount = 0;

  if (rewardType === 'task') {
    amount = TASK_REWARDS[rewardId] || 0;
  }

  if (rewardType === 'survey') {
    amount = SURVEY_REWARDS[rewardId] || 0;
  }

  if (!amount) {
    return send(res, 400, {
      success: false,
      message: 'Invalid reward'
    });
  }

  try {
    const referenceKey = `${rewardType}_${rewardId}`;

    const already = await sql`
      SELECT id
      FROM reward_claims
      WHERE user_id = ${user.id}
        AND reward_type = ${rewardType}
        AND reference_key = ${referenceKey}
      LIMIT 1
    `;

    if (already.length) {
      return send(res, 409, {
        success: false,
        message: 'Reward already claimed'
      });
    }

    await addCoins(user.id, amount);

    await sql`
      INSERT INTO reward_claims (
        id,
        user_id,
        reward_type,
        reference_key,
        title,
        amount
      )
      VALUES (
        ${makeId()},
        ${user.id},
        ${rewardType},
        ${referenceKey},
        ${rewardType === 'task' ? 'Task Reward' : 'Survey Reward'},
        ${amount}
      )
    `;

    const wallet = await getWallet(user.id);

    return send(res, 200, {
      success: true,
      message: `You earned ${amount} coins`,
      amount,
      wallet: walletResponse(wallet)
    });

  } catch (error) {
    console.error(
      'CLAIM REWARD ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Reward claim failed'
    });
  }
}

/* =========================================================
   DAILY BONUS
========================================================= */

async function handleDailyBonus(req, res) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Unauthorized'
    });
  }

  try {
    const today = new Date()
      .toISOString()
      .slice(0, 10);

    const referenceKey = `daily_${today}`;

    const existing = await sql`
      SELECT id
      FROM reward_claims
      WHERE user_id = ${user.id}
        AND reward_type = 'daily_bonus'
        AND reference_key = ${referenceKey}
      LIMIT 1
    `;

    if (existing.length) {
      return send(res, 409, {
        success: false,
        message: 'Daily bonus already claimed today'
      });
    }

    await addCoins(
      user.id,
      DAILY_BONUS_AMOUNT
    );

    await sql`
      INSERT INTO reward_claims (
        id,
        user_id,
        reward_type,
        reference_key,
        title,
        amount
      )
      VALUES (
        ${makeId()},
        ${user.id},
        'daily_bonus',
        ${referenceKey},
        'Daily Bonus',
        ${DAILY_BONUS_AMOUNT}
      )
    `;

    const wallet = await getWallet(user.id);

    return send(res, 200, {
      success: true,
      message: `Daily bonus: ${DAILY_BONUS_AMOUNT} coins`,
      amount: DAILY_BONUS_AMOUNT,
      wallet: walletResponse(wallet)
    });

  } catch (error) {
    console.error(
      'DAILY BONUS ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Daily bonus failed'
    });
  }
}

/* =========================================================
   REFERRAL
========================================================= */

async function handleReferral(req, res) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Unauthorized'
    });
  }

  try {
    const rows = await sql`
      SELECT
        COUNT(*)::int AS total_referrals
      FROM users
      WHERE referred_by = ${user.id}
    `;

    const totalReferrals =
      Number(rows[0]?.total_referrals || 0);

    return send(res, 200, {
      success: true,
      referralCode: user.referral_code,
      totalReferrals
    });

  } catch (error) {
    console.error(
      'REFERRAL ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Referral data failed'
    });
  }
}

/* =========================================================
   KYC STATUS
========================================================= */

async function handleKycStatus(req, res) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Unauthorized'
    });
  }

  try {
    const rows = await sql`
      SELECT
        id,
        user_id,
        full_name,
        document_type,
        document_number,
        document_url,
        status,
        admin_note,
        submitted_at,
        reviewed_at
      FROM kyc_submissions
      WHERE user_id = ${user.id}
      ORDER BY submitted_at DESC
      LIMIT 1
    `;

    return send(res, 200, {
      success: true,
      kyc: rows[0] || null
    });

  } catch (error) {
    console.error(
      'KYC STATUS ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'KYC status failed'
    });
  }
}

/* =========================================================
   SUBMIT KYC
========================================================= */

async function handleSubmitKyc(req, res, body) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Unauthorized'
    });
  }

  const fullName = String(
    body.fullName || ''
  ).trim();

  const documentType = String(
    body.documentType || 'CNIC'
  ).trim();

  const documentNumber = String(
    body.documentNumber || ''
  ).trim();

  if (!fullName || !documentNumber) {
    return send(res, 400, {
      success: false,
      message: 'Full name and document number are required'
    });
  }

  try {
    const latest = await sql`
      SELECT
        id,
        status
      FROM kyc_submissions
      WHERE user_id = ${user.id}
      ORDER BY submitted_at DESC
      LIMIT 1
    `;

    if (latest.length) {
      if (latest[0].status === 'pending') {
        return send(res, 409, {
          success: false,
          message: 'Your KYC is already pending'
        });
      }

      if (latest[0].status === 'approved') {
        return send(res, 409, {
          success: false,
          message: 'Your KYC is already approved'
        });
      }
    }

    const inserted = await sql`
      INSERT INTO kyc_submissions (
        user_id,
        full_name,
        document_type,
        document_number,
        document_url,
        status,
        admin_note,
        submitted_at
      )
      VALUES (
        ${user.id},
        ${fullName},
        ${documentType},
        ${documentNumber},
        '',
        'pending',
        NULL,
        NOW()
      )
      RETURNING
        id,
        user_id,
        full_name,
        document_type,
        document_number,
        document_url,
        status,
        admin_note,
        submitted_at,
        reviewed_at
    `;

    return send(res, 201, {
      success: true,
      message: 'KYC submitted successfully',
      kyc: inserted[0]
    });

  } catch (error) {
    console.error(
      'SUBMIT KYC ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'KYC submission failed',
      error: error.message
    });
  }
}

/* =========================================================
   WITHDRAWAL
========================================================= */

async function handleWithdrawal(req, res, body) {
  const user = await getUserFromToken(req);

  if (!user) {
    return send(res, 401, {
      success: false,
      message: 'Unauthorized'
    });
  }

  const amount = Number(body.amount);

  const paymentMethod = String(
    body.paymentMethod ||
    body.method ||
    ''
  ).trim().toLowerCase();

  const paymentAccount = String(
    body.account ||
    body.paymentAccount ||
    ''
  ).trim();

  if (
    !Number.isInteger(amount) ||
    amount < MIN_WITHDRAWAL
  ) {
    return send(res, 400, {
      success: false,
      message: `Minimum withdrawal is ${MIN_WITHDRAWAL} coins`
    });
  }

  if (
    !['easypaisa', 'jazzcash', 'bank']
      .includes(paymentMethod)
  ) {
    return send(res, 400, {
      success: false,
      message: 'Invalid payment method'
    });
  }

  if (!paymentAccount) {
    return send(res, 400, {
      success: false,
      message: 'Payment account is required'
    });
  }

  try {
    const pending = await sql`
      SELECT id
      FROM withdrawals
      WHERE user_id = ${user.id}
        AND status = 'pending'
      LIMIT 1
    `;

    if (pending.length) {
      return send(res, 409, {
        success: false,
        message: 'You already have a pending withdrawal'
      });
    }

    const wallet = await getWallet(user.id);

    if (Number(wallet.balance || 0) < amount) {
      return send(res, 400, {
        success: false,
        message: 'Insufficient balance'
      });
    }

    /*
      Deduct balance immediately.
      If admin rejects, amount will be returned.
    */

    const walletUpdate = await sql`
      UPDATE wallets
      SET
        balance = balance - ${amount},
        updated_at = NOW()
      WHERE user_id = ${user.id}
        AND balance >= ${amount}
      RETURNING
        id,
        user_id,
        balance,
        total_earned,
        total_withdrawn,
        created_at,
        updated_at
    `;

    if (!walletUpdate.length) {
      return send(res, 400, {
        success: false,
        message: 'Insufficient balance'
      });
    }

    await sql`
      UPDATE users
      SET coins = GREATEST(
        COALESCE(coins, 0) - ${amount},
        0
      )
      WHERE id = ${user.id}
    `;

    const inserted = await sql`
      INSERT INTO withdrawals (
        user_id,
        amount,
        payment_method,
        payment_account,
        status,
        admin_note,
        created_at,
        updated_at
      )
      VALUES (
        ${user.id},
        ${amount},
        ${paymentMethod},
        ${paymentAccount},
        'pending',
        NULL,
        NOW(),
        NOW()
      )
      RETURNING
        id,
        user_id,
        amount,
        payment_method,
        payment_account,
        status,
        admin_note,
        created_at,
        updated_at,
        reviewed_at
    `;

    return send(res, 201, {
      success: true,
      message: 'Withdrawal request submitted',
      withdrawal: inserted[0],
      wallet: walletResponse(
        walletUpdate[0]
      )
    });

  } catch (error) {
    console.error(
      'WITHDRAWAL ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Withdrawal request failed',
      error: error.message
    });
  }
}

/* =========================================================
   ADMIN AUTH CHECK
========================================================= */

async function getAdmin(req) {
  const user = await getUserFromToken(req);

  if (!user) {
    return null;
  }

  if (user.role !== 'admin') {
    return null;
  }

  return user;
}

/* =========================================================
   ADMIN STATS
========================================================= */

async function handleAdminStats(req, res) {
  try {
    const admin = await getAdmin(req);

    if (!admin) {
      return send(res, 403, {
        success: false,
        message: 'Admin access required'
      });
    }

    const usersRows = await sql`
      SELECT COUNT(*)::int AS count
      FROM users
    `;

    const coinsRows = await sql`
      SELECT COALESCE(
        SUM(balance),
        0
      )::bigint AS total
      FROM wallets
    `;

    const withdrawalRows = await sql`
      SELECT COUNT(*)::int AS count
      FROM withdrawals
      WHERE status = 'approved'
    `;

    const pendingWithdrawalRows = await sql`
      SELECT COUNT(*)::int AS count
      FROM withdrawals
      WHERE status = 'pending'
    `;

    const pendingKycRows = await sql`
      SELECT COUNT(*)::int AS count
      FROM kyc_submissions
      WHERE status = 'pending'
    `;

    const referralRows = await sql`
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE referred_by IS NOT NULL
    `;

    return send(res, 200, {
      success: true,
      stats: {
        totalUsers:
          Number(usersRows[0]?.count || 0),

        totalCoins:
          Number(coinsRows[0]?.total || 0),

        totalWithdrawals:
          Number(withdrawalRows[0]?.count || 0),

        pendingWithdrawals:
          Number(
            pendingWithdrawalRows[0]?.count || 0
          ),

        pendingKyc:
          Number(
            pendingKycRows[0]?.count || 0
          ),

        totalReferrals:
          Number(referralRows[0]?.count || 0)
      }
    });

  } catch (error) {
    console.error(
      'ADMIN STATS ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Admin stats failed',
      error: error.message
    });
  }
}

/* =========================================================
   ADMIN USERS
   GET = LIST USERS
   POST = BLOCK / UNBLOCK / DISABLE / ENABLE
========================================================= */

async function handleAdminUsers(req, res) {
  try {
    const admin = await getAdmin(req);

    if (!admin) {
      return send(res, 403, {
        success: false,
        message: 'Admin access required'
      });
    }

    /* -------------------------
       GET USERS
    ------------------------- */

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT
          id,
          name,
          username,
          email,
          phone,
          role,
          coins,
          created_at,
          referral_code,
          referred_by,
          status
        FROM users
        ORDER BY created_at DESC
      `;

      return send(res, 200, {
        success: true,
        users: rows
      });
    }

    /* -------------------------
       POST USER ACTION
    ------------------------- */

    if (req.method === 'POST') {
      const body = await readBody(req);

      const userId = String(
        body.id || ''
      ).trim();

      const action = String(
        body.action || ''
      ).trim().toLowerCase();

      if (!userId) {
        return send(res, 400, {
          success: false,
          message: 'User ID is required'
        });
      }

      const allowedActions = [
        'block',
        'unblock',
        'disable',
        'enable'
      ];

      if (!allowedActions.includes(action)) {
        return send(res, 400, {
          success: false,
          message: 'Invalid user action'
        });
      }

      /*
        Admin cannot modify own account.
      */

      if (String(userId) === String(admin.id)) {
        return send(res, 400, {
          success: false,
          message: 'Admin account cannot be modified'
        });
      }

      const targetRows = await sql`
        SELECT
          id,
          role,
          status
        FROM users
        WHERE id = ${userId}
        LIMIT 1
      `;

      if (!targetRows.length) {
        return send(res, 404, {
          success: false,
          message: 'User not found'
        });
      }

      const target = targetRows[0];

      /*
        Protect every admin account.
      */

      if (target.role === 'admin') {
        return send(res, 400, {
          success: false,
          message: 'Admin account cannot be modified'
        });
      }

      let newStatus = 'active';

      if (action === 'block') {
        newStatus = 'blocked';
      }

      if (
        action === 'unblock' ||
        action === 'enable'
      ) {
        newStatus = 'active';
      }

      if (action === 'disable') {
        newStatus = 'disabled';
      }

      const updated = await sql`
        UPDATE users
        SET status = ${newStatus}
        WHERE id = ${userId}
          AND role <> 'admin'
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
          referred_by,
          status
      `;

      if (!updated.length) {
        return send(res, 400, {
          success: false,
          message: 'User could not be updated'
        });
      }

      /*
        Remove all active sessions when blocking
        or disabling a user.
      */

      if (
        newStatus === 'blocked' ||
        newStatus === 'disabled'
      ) {
        await sql`
          DELETE FROM admin_sessions
          WHERE user_id = ${userId}
        `;
      }

      return send(res, 200, {
        success: true,
        message: `User ${newStatus}`,
        user: updated[0]
      });
    }

    return send(res, 405, {
      success: false,
      message: 'Method not allowed'
    });

  } catch (error) {
    console.error(
      'ADMIN USERS ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Admin users operation failed',
      error: error.message
    });
  }
}

/* =========================================================
   ADMIN KYC
========================================================= */

async function handleAdminKyc(req, res) {
  try {
    const admin = await getAdmin(req);

    if (!admin) {
      return send(res, 403, {
        success: false,
        message: 'Admin access required'
      });
    }

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT
          k.id,
          k.user_id,
          k.full_name,
          k.document_type,
          k.document_number,
          k.document_url,
          k.status,
          k.admin_note,
          k.submitted_at,
          k.reviewed_at,
          u.name AS user_name,
          u.username,
          u.email,
          u.phone
        FROM kyc_submissions k
        LEFT JOIN users u
          ON u.id = k.user_id
        ORDER BY k.submitted_at DESC
      `;

      return send(res, 200, {
        success: true,
        kyc: rows
      });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);

      const id = body.id;

      const action = String(
        body.action || ''
      ).trim().toLowerCase();

      const note = String(
        body.note || ''
      ).trim();

      if (!id) {
        return send(res, 400, {
          success: false,
          message: 'KYC ID is required'
        });
      }

      if (
        action !== 'approve' &&
        action !== 'reject'
      ) {
        return send(res, 400, {
          success: false,
          message: 'Invalid KYC action'
        });
      }

      const existing = await sql`
        SELECT
          id,
          user_id,
          status
        FROM kyc_submissions
        WHERE id = ${id}
        LIMIT 1
      `;

      if (!existing.length) {
        return send(res, 404, {
          success: false,
          message: 'KYC record not found'
        });
      }

      if (existing[0].status !== 'pending') {
        return send(res, 409, {
          success: false,
          message: 'This KYC has already been reviewed'
        });
      }

      const newStatus =
        action === 'approve'
          ? 'approved'
          : 'rejected';

      const updated = await sql`
        UPDATE kyc_submissions
        SET
          status = ${newStatus},
          admin_note = ${note || null},
          reviewed_at = NOW()
        WHERE id = ${id}
          AND status = 'pending'
        RETURNING
          id,
          user_id,
          full_name,
          document_type,
          document_number,
          document_url,
          status,
          admin_note,
          submitted_at,
          reviewed_at
      `;

      if (!updated.length) {
        return send(res, 409, {
          success: false,
          message: 'KYC could not be updated'
        });
      }

      return send(res, 200, {
        success: true,
        message:
          newStatus === 'approved'
            ? 'KYC approved successfully'
            : 'KYC rejected successfully',
        kyc: updated[0]
      });
    }

    return send(res, 405, {
      success: false,
      message: 'Method not allowed'
    });

  } catch (error) {
    console.error(
      'ADMIN KYC ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Admin KYC operation failed',
      error: error.message
    });
  }
}

/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

async function handleAdminWithdrawals(req, res) {
  try {
    const admin = await getAdmin(req);

    if (!admin) {
      return send(res, 403, {
        success: false,
        message: 'Admin access required'
      });
    }

    /* -------------------------
       GET WITHDRAWALS
    ------------------------- */

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT
          w.id,
          w.user_id,
          w.amount,
          w.payment_method,
          w.payment_account,
          w.status,
          w.admin_note,
          w.created_at,
          w.updated_at,
          w.reviewed_at,
          u.name AS user_name,
          u.username,
          u.email
        FROM withdrawals w
        LEFT JOIN users u
          ON u.id = w.user_id
        ORDER BY w.created_at DESC
      `;

      return send(res, 200, {
        success: true,
        withdrawals: rows
      });
    }

    /* -------------------------
       APPROVE / REJECT
    ------------------------- */

    if (req.method === 'POST') {
      const body = await readBody(req);

      const id = body.id;

      const action = String(
        body.action || ''
      ).trim().toLowerCase();

      const note = String(
        body.note || ''
      ).trim();

      if (!id) {
        return send(res, 400, {
          success: false,
          message: 'Withdrawal ID is required'
        });
      }

      if (
        action !== 'approve' &&
        action !== 'reject'
      ) {
        return send(res, 400, {
          success: false,
          message: 'Invalid withdrawal action'
        });
      }

      const existing = await sql`
        SELECT
          id,
          user_id,
          amount,
          status
        FROM withdrawals
        WHERE id = ${id}
        LIMIT 1
      `;

      if (!existing.length) {
        return send(res, 404, {
          success: false,
          message: 'Withdrawal not found'
        });
      }

      const withdrawal = existing[0];

      if (withdrawal.status !== 'pending') {
        return send(res, 409, {
          success: false,
          message: 'This withdrawal has already been reviewed'
        });
      }

      const amount = Number(
        withdrawal.amount || 0
      );

      /* -------------------------
         APPROVE
      ------------------------- */

      if (action === 'approve') {
        await sql`
          UPDATE wallets
          SET
            total_withdrawn =
              COALESCE(total_withdrawn, 0)
              + ${amount},
            updated_at = NOW()
          WHERE user_id = ${withdrawal.user_id}
        `;

        const updated = await sql`
          UPDATE withdrawals
          SET
            status = 'approved',
            admin_note = ${note || null},
            reviewed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${id}
            AND status = 'pending'
          RETURNING
            id,
            user_id,
            amount,
            payment_method,
            payment_account,
            status,
            admin_note,
            created_at,
            updated_at,
            reviewed_at
        `;

        if (!updated.length) {
          return send(res, 409, {
            success: false,
            message: 'Withdrawal could not be approved'
          });
        }

        return send(res, 200, {
          success: true,
          message: 'Withdrawal approved successfully',
          withdrawal: updated[0]
        });
      }

      /* -------------------------
         REJECT
      ------------------------- */

      if (action === 'reject') {
        /*
          Return coins to wallet.
        */

        await sql`
          UPDATE wallets
          SET
            balance =
              COALESCE(balance, 0)
              + ${amount},
            updated_at = NOW()
          WHERE user_id = ${withdrawal.user_id}
        `;

        /*
          Return coins to users table too.
        */

        await sql`
          UPDATE users
          SET
            coins =
              COALESCE(coins, 0)
              + ${amount}
          WHERE id = ${withdrawal.user_id}
        `;

        const updated = await sql`
          UPDATE withdrawals
          SET
            status = 'rejected',
            admin_note = ${note || null},
            reviewed_at = NOW(),
            updated_at = NOW()
          WHERE id = ${id}
            AND status = 'pending'
          RETURNING
            id,
            user_id,
            amount,
            payment_method,
            payment_account,
            status,
            admin_note,
            created_at,
            updated_at,
            reviewed_at
        `;

        if (!updated.length) {
          return send(res, 409, {
            success: false,
            message: 'Withdrawal could not be rejected'
          });
        }

        return send(res, 200, {
          success: true,
          message: 'Withdrawal rejected and coins returned',
          withdrawal: updated[0]
        });
      }
    }

    return send(res, 405, {
      success: false,
      message: 'Method not allowed'
    });

  } catch (error) {
    console.error(
      'ADMIN WITHDRAWALS ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Admin withdrawal operation failed',
      error: error.message
    });
  }
}

/* =========================================================
   LOGOUT
========================================================= */

async function handleLogout(req, res) {
  const token = getToken(req);

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

/* =========================================================
   PATH
========================================================= */

function getPath(req) {
  const url = req.url || '/';

  return url.split('?')[0];
}

/* =========================================================
   MAIN ROUTER
========================================================= */

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      return send(res, 200, {
        success: true
      });
    }

    const path = getPath(req);

    /* -----------------------------------------
       DIRECT ADMIN ROUTES
    ----------------------------------------- */

    if (
      path === '/api/admin/stats' ||
      path === '/admin/stats'
    ) {
      return handleAdminStats(req, res);
    }

    if (
      path === '/api/admin/users' ||
      path === '/admin/users'
    ) {
      return handleAdminUsers(req, res);
    }

    if (
      path === '/api/admin/kyc' ||
      path === '/admin/kyc'
    ) {
      return handleAdminKyc(req, res);
    }

    if (
      path === '/api/admin/withdrawals' ||
      path === '/admin/withdrawals'
    ) {
      return handleAdminWithdrawals(req, res);
    }

    /* -----------------------------------------
       ACTION ROUTES
    ----------------------------------------- */

    if (
      path === '/api' ||
      path === '/api/index' ||
      path === '/action'
    ) {
      let body = {};

      if (
        req.method === 'POST' ||
        req.method === 'PUT' ||
        req.method === 'PATCH'
      ) {
        body = await readBody(req);
      }

      const action = String(
        body.action || ''
      ).trim().toLowerCase();

      switch (action) {
        case 'login':
          return handleLogin(
            req,
            res,
            body
          );

        case 'register':
          return handleRegister(
            req,
            res,
            body
          );

        case 'dashboard':
          return handleDashboard(
            req,
            res
          );

        case 'wallet':
          return handleWallet(
            req,
            res
          );

        case 'claim_reward':
          return handleClaimReward(
            req,
            res,
            body
          );

        case 'daily_bonus':
          return handleDailyBonus(
            req,
            res
          );

        case 'referral':
        case 'referrals':
        case 'referral_stats':
          return handleReferral(
            req,
            res
          );

        case 'kyc_status':
          return handleKycStatus(
            req,
            res
          );

        case 'submit_kyc':
          return handleSubmitKyc(
            req,
            res,
            body
          );

        case 'withdraw':
          return handleWithdrawal(
            req,
            res,
            body
          );

        case 'logout':
          return handleLogout(
            req,
            res
          );

        case 'admin_stats':
          return handleAdminStats(
            req,
            res
          );

        case 'admin_users':
          return handleAdminUsers(
            req,
            res
          );

        case 'admin_kyc':
          return handleAdminKyc(
            req,
            res
          );

        case 'admin_withdrawals':
          return handleAdminWithdrawals(
            req,
            res
          );

        default:
          return send(res, 400, {
            success: false,
            message: 'Unknown action'
          });
      }
    }

    return send(res, 404, {
      success: false,
      message: 'API route not found'
    });

  } catch (error) {
    console.error(
      'API ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
