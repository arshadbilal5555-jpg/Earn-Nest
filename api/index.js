'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
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

function makeReferralCode(username) {
  const base = clean(username)
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);

  const random = crypto.randomBytes(3).toString('hex').toUpperCase();

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

async function handleRegister(body, res) {
  const name = clean(body.name);
  const username = clean(body.username).toLowerCase();
  const userEmail = email(body.email);
  const phone = clean(body.phone);
  const password = String(body.password || '');
  const confirmPassword = String(
    body.confirmPassword || body.confirm || ''
  );

  const referralCode = clean(
    body.referralCode ||
    body.ref ||
    ''
  ).toUpperCase();

  if (!name || !username || !userEmail || !password) {
    return send(res, 400, {
      success: false,
      message: 'Name, username, email and password are required'
    });
  }

  if (password.length < 6) {
    return send(res, 400, {
      success: false,
      message: 'Password must be at least 6 characters'
    });
  }

  if (password !== confirmPassword) {
    return send(res, 400, {
      success: false,
      message: 'Passwords do not match'
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

      if (String(found.username).toLowerCase() === username) {
        return send(res, 409, {
          success: false,
          message: 'Username already exists'
        });
      }

      return send(res, 409, {
        success: false,
        message: 'Email already exists'
      });
    }

    let referrer = null;

    if (referralCode) {
      const refRows = await sql`
        SELECT id, username, referral_code
        FROM users
        WHERE UPPER(referral_code) = ${referralCode}
        LIMIT 1
      `;

      if (!refRows.length) {
        return send(res, 400, {
          success: false,
          message: 'Invalid referral code'
        });
      }

      referrer = refRows[0];

      if (String(referrer.username).toLowerCase() === username) {
        return send(res, 400, {
          success: false,
          message: 'You cannot use your own referral code'
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
          ${referrer ? referrer.referral_code : null},
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

    /*
     * Referral bonus
     * Referrer receives 100 coins.
     */
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
          balance = COALESCE(balance, 0) + ${bonus},
          total_earned = COALESCE(total_earned, 0) + ${bonus}
        WHERE user_id = ${referrer.id}
      `;

      await sql`
        UPDATE users
        SET coins = COALESCE(coins, 0) + ${bonus}
        WHERE id = ${referrer.id}
      `;
    }

    return send(res, 201, {
      success: true,
      message: referrer
        ? 'Account created successfully. Referral bonus added to your referrer.'
        : 'Account created successfully',
      user: {
        id: userId,
        name,
        username,
        email: userEmail,
        phone,
        role: 'user',
        coins: 0,
        balance: 0,
        referralCode: newReferralCode,
        referredBy: referrer
          ? referrer.referral_code
          : null
      }
    });

  } catch (error) {
    console.error('Registration API error:', error);

    return send(res, 500, {
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
}

async function handleLogin(body, res) {
  const login = email(
    body.login ||
    body.email ||
    body.username
  );

  const password = String(body.password || '');

  if (!login || !password) {
    return send(res, 400, {
      success: false,
      message: 'Email/username and password are required'
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
      message: 'Invalid email/username or password'
    });
  }

  const token = crypto.randomUUID();

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

  let walletRows = await sql`
    SELECT *
    FROM wallets
    WHERE user_id = ${user.id}
    LIMIT 1
  `;

  if (!walletRows.length) {
    await sql`
      INSERT INTO wallets
        (user_id, balance, total_earned, total_withdrawn)
      VALUES
        (${user.id}, 0, 0, 0)
    `;

    walletRows = await sql`
      SELECT *
      FROM wallets
      WHERE user_id = ${user.id}
      LIMIT 1
    `;
  }

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
      coins: Number(wallet?.balance || user.coins || 0),
      balance: Number(wallet?.balance || user.coins || 0),
      totalEarned: Number(wallet?.total_earned || 0),
      totalWithdrawn: Number(wallet?.total_withdrawn || 0),
      referralCode: user.referral_code || '',
      referredBy: user.referred_by || ''
    }
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    );
    return res.end();
  }

  if (req.method !== 'POST') {
    return send(res, 405, {
      success: false,
      message: 'Method not allowed. Use POST.'
    });
  }

  try {
    const body = await readBody(req);

    /*
     * Registration requests send action: "register".
     * All other requests continue to use the existing login flow.
     */
    if (body.action === 'register') {
      return await handleRegister(body, res);
    }

    return await handleLogin(body, res);

  } catch (error) {
    console.error('API error:', error);

    return send(res, 500, {
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};
