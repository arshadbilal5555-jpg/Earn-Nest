
'use strict';

const crypto = require('crypto');
const { neon, Pool } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
const sql = DATABASE_URL ? neon(DATABASE_URL) : null;
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, max: 1 })
  : null;

const DAILY_BONUS_AMOUNT = 50;
const REFERRER_REWARD = 100;
const NEW_USER_REFERRAL_BONUS = 50;
const MIN_WITHDRAWAL = 1000;

const TASK_REWARDS = {
  task1: 50, task2: 100, task3: 75, task4: 100,
  task5: 150, task6: 50, task7: 50, task8: 75
};

const SURVEY_REWARDS = {
  survey1: 150, survey2: 200, survey3: 250,
  survey4: 300, survey5: 250
};

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(data));
}

function makeId() {
  return crypto.randomBytes(16).toString('hex');
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function makeReferralCode(username) {
  const prefix = String(username || 'USER')
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toUpperCase() || 'USER';
  return prefix + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function getToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new Error('Invalid JSON body'));
        }
        resolve(parsed);
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash, encoded: `scrypt$${salt}$${hash}` };
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;

  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const actual = crypto.scryptSync(password, parts[1], 64);
    const expected = Buffer.from(parts[2], 'hex');
    return actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected);
  }

  // Compatibility for existing accounts that used plain-text passwords.
  // Migrate these accounts to hashed passwords after a successful login.
  return stored === password;
}

function walletResponse(wallet) {
  return {
    balance: Number(wallet.balance || 0),
    totalEarned: Number(wallet.total_earned || 0),
    totalWithdrawn: Number(wallet.total_withdrawn || 0)
  };
}

async function getWallet(userId) {
  const rows = await sql`
    SELECT id, user_id, balance, total_earned, total_withdrawn,
           created_at, updated_at
    FROM wallets WHERE user_id = ${userId} LIMIT 1
  `;
  if (rows.length) return rows[0];

  const created = await sql`
    INSERT INTO wallets (user_id, balance, total_earned, total_withdrawn)
    VALUES (${userId}, 0, 0, 0)
    RETURNING id, user_id, balance, total_earned, total_withdrawn,
              created_at, updated_at
  `;
  return created[0];
}

async function addCoins(userId, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Invalid reward amount');
  }

  // Keep users.coins and wallets.balance synchronized.
  const result = await pool.connect();
  try {
    await result.query('BEGIN');

    const user = await result.query(
      'SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]
    );
    if (!user.rows.length) throw new Error('User not found');

    await result.query(
      `INSERT INTO wallets (user_id, balance, total_earned, total_withdrawn)
       VALUES ($1, 0, 0, 0) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    await result.query(
      'UPDATE users SET coins = COALESCE(coins, 0) + $1 WHERE id = $2',
      [amount, userId]
    );

    const updated = await result.query(
      `UPDATE wallets
       SET balance = COALESCE(balance, 0) + $1,
           total_earned = COALESCE(total_earned, 0) + $1,
           updated_at = NOW()
       WHERE user_id = $2
       RETURNING id, user_id, balance, total_earned, total_withdrawn,
                 created_at, updated_at`,
      [amount, userId]
    );

    await result.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    try { await result.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    result.release();
  }
}

async function getUserFromToken(req) {
  const token = getToken(req);
  if (!token) return null;

  const rows = await sql`
    SELECT u.id, u.name, u.username, u.email, u.phone, u.role,
           u.coins, u.created_at, u.referral_code, u.referred_by, u.status
    FROM admin_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > NOW()
    LIMIT 1
  `;

  if (!rows.length || rows[0].status !== 'active') return null;
  return rows[0];
}

async function createSession(userId) {
  const token = makeToken();
  await sql`
    INSERT INTO admin_sessions (user_id, token, expires_at)
    VALUES (${userId}, ${token}, NOW() + INTERVAL '30 days')
  `;
  return token;
}

function publicUser(user) {
  return {
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
  };
}

async function handleRegister(req, res, body) {
  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');
  const confirm = String(body.confirmPassword || body.confirm || '');
  const referralCode = String(body.referralCode || body.referral || '').trim();

  if (!name || !username || !email || !password) {
    return send(res, 400, { success: false, message: 'Please fill all required fields' });
  }
  if (password.length < 8) {
    return send(res, 400, { success: false, message: 'Password must be at least 8 characters' });
  }
  if (confirm && password !== confirm) {
    return send(res, 400, { success: false, message: 'Passwords do not match' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return send(res, 400, { success: false, message: 'Enter a valid email address' });
  }

  try {
    const duplicates = await sql`
      SELECT email, username FROM users
      WHERE LOWER(email) = ${email} OR LOWER(username) = LOWER(${username})
      LIMIT 1
    `;
    if (duplicates.length) {
      const sameEmail = String(duplicates[0].email).toLowerCase() === email;
      return send(res, 409, {
        success: false,
        message: sameEmail ? 'Email already registered' : 'Username already taken'
      });
    }

    let referredBy = null;
    if (referralCode) {
      const refs = await sql`
        SELECT id FROM users
        WHERE LOWER(referral_code) = LOWER(${referralCode})
        LIMIT 1
      `;
      if (refs.length) referredBy = refs[0].id;
    }

    const userId = makeId();
    let code = makeReferralCode(username);
    for (let i = 0; i < 5; i++) {
      const exists = await sql`
        SELECT id FROM users WHERE referral_code = ${code} LIMIT 1
      `;
      if (!exists.length) break;
      code = makeReferralCode(username);
    }

    const secured = hashPassword(password);

    const inserted = await sql`
      INSERT INTO users
        (id, name, username, email, phone, password, role, coins,
         referral_code, referred_by, status)
      VALUES
        (${userId}, ${name}, ${username}, ${email}, ${phone},
         ${secured.encoded}, 'user', 0, ${code}, ${referredBy}, 'active')
      RETURNING id, name, username, email, phone, role, coins,
                created_at, referral_code, referred_by, status
    `;
    const user = inserted[0];

    await getWallet(user.id);

    if (referredBy && referredBy !== user.id) {
      try {
        const key = `signup_${user.id}`;
        const existing = await sql`
          SELECT id FROM reward_claims
          WHERE user_id = ${referredBy}
            AND reward_type = 'referral'
            AND reference_key = ${key}
          LIMIT 1
        `;
        if (!existing.length) {
          await addCoins(referredBy, REFERRER_REWARD);
          await sql`
            INSERT INTO reward_claims
              (id, user_id, reward_type, reference_key, title, amount)
            VALUES
              (${makeId()}, ${referredBy}, 'referral', ${key},
               'Referral Reward', ${REFERRER_REWARD})
          `;
        }

        await addCoins(user.id, NEW_USER_REFERRAL_BONUS);
        await sql`
          INSERT INTO reward_claims
            (id, user_id, reward_type, reference_key, title, amount)
          VALUES
            (${makeId()}, ${user.id}, 'referral_bonus',
             ${`welcome_${user.id}`}, 'Referral Welcome Bonus',
             ${NEW_USER_REFERRAL_BONUS})
        `;
      } catch (error) {
        console.error('REFERRAL REWARD ERROR:', error.message);
      }
    }

    const token = await createSession(user.id);
    const wallet = await getWallet(user.id);
    const currentUser = await sql`
      SELECT id, name, username, email, phone, role, coins, created_at,
             referral_code, referred_by, status
      FROM users WHERE id = ${user.id} LIMIT 1
    `;

    return send(res, 201, {
      success: true,
      message: 'Account created successfully',
      token,
      user: publicUser(currentUser[0] || user),
      wallet: walletResponse(wallet)
    });
  } catch (error) {
    console.error('REGISTER ERROR:', error);
    return send(res, 500, { success: false, message: 'Account creation failed' });
  }
}

async function handleLogin(req, res, body) {
  const login = String(body.login || body.email || body.username || '').trim();
  const password = String(body.password || '');

  if (!login || !password) {
    return send(res, 400, { success: false, message: 'Login and password are required' });
  }

  try {
    const rows = await sql`
      SELECT id, name, username, email, phone, password, role, coins,
             created_at, referral_code, referred_by, status
      FROM users
      WHERE LOWER(email) = LOWER(${login}) OR LOWER(username) = LOWER(${login})
      LIMIT 1
    `;

    if (!rows.length || !verifyPassword(password, rows[0].password)) {
      return send(res, 401, { success: false, message: 'Invalid login details' });
    }

    const user = rows[0];
    if (user.status !== 'active') {
      return send(res, 403, { success: false, message: 'Your account is not active. Please contact support.' });
    }

    // Upgrade legacy plain-text passwords after successful authentication.
    if (!String(user.password).startsWith('scrypt$')) {
      const secured = hashPassword(password);
      await sql`UPDATE users SET password = ${secured.encoded} WHERE id = ${user.id}`;
    }

    const token = await createSession(user.id);
    const wallet = await getWallet(user.id);

    return send(res, 200, {
      success: true,
      message: 'Login successful',
      token,
      user: publicUser(user),
      wallet: walletResponse(wallet)
    });
  } catch (error) {
    console.error('LOGIN ERROR:', error);
    return send(res, 500, { success: false, message: 'Server error' });
  }
}

async function handleDashboard(req, res) {
  const user = await getUserFromToken(req);
  if (!user) return send(res, 401, { success: false, message: 'Unauthorized' });
  const wallet = await getWallet(user.id);
  return send(res, 200, { success: true, user: publicUser(user), wallet: walletResponse(wallet) });
}

async function handleWallet(req, res) {
  const user = await getUserFromToken(req);
  if (!user) return send(res, 401, { success: false, message: 'Unauthorized' });
  const wallet = await getWallet(user.id);
  return send(res, 200, { success: true, wallet: walletResponse(wallet), coins: Number(user.coins || 0) });
}

async function handleClaimReward(req, res, body) {
  const user = await getUserFromToken(req);
  if (!user) return send(res, 401, { success: false, message: 'Unauthorized' });

  const type = String(body.rewardType || '').trim().toLowerCase();
  const id = String(body.rewardId || '').trim();
  const amount = type === 'task' ? TASK_REWARDS[id] :
                 type === 'survey' ? SURVEY_REWARDS[id] : 0;
  if (!amount) return send(res, 400, { success: false, message: 'Invalid reward' });

  const key = `${type}_${id}`;
  try {
    const claimed = await sql`
      SELECT id FROM reward_claims
      WHERE user_id = ${user.id} AND reward_type = ${type}
        AND reference_key = ${key} LIMIT 1
    `;
    if (claimed.length) return send(res, 409, { success: false, message: 'Reward already claimed' });

    // Claim record first; a unique DB constraint is recommended on
    // (user_id, reward_type, reference_key) to stop concurrent duplicate claims.
    await sql`
      INSERT INTO reward_claims (id, user_id, reward_type, reference_key, title, amount)
      VALUES (${makeId()}, ${user.id}, ${type}, ${key},
              ${type === 'task' ? 'Task Reward' : 'Survey Reward'}, ${amount})
    `;
    const wallet = await addCoins(user.id, amount);
    return send(res, 200, {
      success: true, message: `You earned ${amount} coins`,
      amount, wallet: walletResponse(wallet)
    });
  } catch (error) {
    console.error('CLAIM REWARD ERROR:', error);
    return send(res, 500, { success: false, message: 'Reward claim failed' });
  }
}

async function handleDailyBonus(req, res) {
  const user = await getUserFromToken(req);
  if (!user) return send(res, 401, { success: false, message: 'Unauthorized' });

  const today = new Date().toISOString().slice(0, 10);
  const key = `daily_${today}`;
  try {
    const existing = await sql`
      SELECT id FROM reward_claims
      WHERE user_id = ${user.id} AND reward_type = 'daily_bonus'
        AND reference_key = ${key} LIMIT 1
    `;
    if (existing.length) {
      return send(res, 409, { success: false, message: 'Daily bonus already claimed today' });
    }

    await sql`
      INSERT INTO reward_claims (id, user_id, reward_type, reference_key, title, amount)
      VALUES (${makeId()}, ${user.id}, 'daily_bonus', ${key}, 'Daily Bonus', ${DAILY_BONUS_AMOUNT})
    `;
    const wallet = await addCoins(user.id, DAILY_BONUS_AMOUNT);
    return send(res, 200, {
      success: true, message: `Daily bonus: ${DAILY_BONUS_AMOUNT} coins`,
      amount: DAILY_BONUS_AMOUNT, wallet: walletResponse(wallet)
    });
  } catch (error) {
    console.error('DAILY BONUS ERROR:', error);
    return send(res, 500, { success: false, message: 'Daily bonus failed' });
  }
}

async function handleReferral(req, res) {
  const user = await getUserFromToken(req);
  if (!user) return send(res, 401, { success: false, message: 'Unauthorized' });
  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS total_referrals
      FROM users WHERE referred_by = ${user.id}
    `;
    return send(res, 200, {
      success: true,
      referralCode: user.referral_code,
      totalReferrals: Number(rows[0]?.total_referrals || 0)
    });
  } catch (error) {
    console.error('REFERRAL ERROR:', error);
    return send(res, 500, { success: false, message: 'Referral data failed' });
  }
}

async function handleLogout(req, res) {
  const token = getToken(req);
  if (token) {
    await sql`DELETE FROM admin_sessions WHERE token = ${token}`;
  }
  return send(res, 200, { success: true, message: 'Logged out' });
}

async function handleKycStatus(req, res) {
  const user = await getUserFromToken(req);
  if (!user) return send(res, 401, { success: false, message: 'Unauthorized' });
  try {
    const rows = await sql`
      SELECT id, user_id, full_name, document_type, document_number,
             document_url, status, admin_note, submitted_at, reviewed_at
      FROM kyc_submissions WHERE user_id = ${user.id}
      ORDER BY submitted_at DESC LIMIT 1
    `;
    return send(res, 200, { success: true, kyc: rows[0] || null });
  } catch (error) {
    console.error('KYC STATUS ERROR:', error);
    return send(res, 500, { success: false, message: 'KYC status failed' });
  }
}

async function handleSubmitKyc(req, res, body) {
  const user = await getUserFromToken(req);
  if (!user) return send(res, 401, { success: false, message: 'Unauthorized' });

  const fullName = String(body.fullName || '').trim();
  const documentType = String(body.documentType || 'CNIC').trim();
  const documentNumber = String(body.documentNumber || '').trim();
  if (!fullName || !documentNumber) {
    return send(res, 400, { success: false, message: 'Full name and document number are required' });
  }

  try {
    const latest = await sql`
      SELECT status FROM kyc_submissions
      WHERE user_id = ${user.id}
      ORDER BY submitted_at DESC LIMIT 1
    `;
    if (latest.length && ['pending', 'approved'].includes(latest[0].status)) {
      return send(res, 409, {
        success: false,
        message: latest[0].status === 'pending'
          ? 'Your KYC is already pending'
          : 'Your KYC is already approved'
      });
    }

    const rows = await sql`
      INSERT INTO kyc_submissions
        (user_id, full_name, document_type, document_number, document_url,
         status, admin_note, submitted_at)
      VALUES (${user.id}, ${fullName}, ${documentType}, ${documentNumber},
              '', 'pending', NULL, NOW())
      RETURNING id, user_id, full_name, document_type, document_number,
                document_url, status, admin_note, submitted_at, reviewed_at
    `;
    return send(res, 201, { success: true, message: 'KYC submitted successfully', kyc: rows[0] });
  } catch (error) {
    console.error('SUBMIT KYC ERROR:', error);
    return send(res, 500, { success: false, message: 'KYC submission failed' });
  }
}

async function handleWithdrawal(req, res, body) {
  const user = await getUserFromToken(req);
  if (!user) return send(res, 401, { success: false, message: 'Unauthorized' });

  const amount = Number(body.amount);
  const method = String(body.paymentMethod || body.method || '').trim().toLowerCase();
  const account = String(body.account || body.paymentAccount || '').trim();

  if (!Number.isSafeInteger(amount) || amount < MIN_WITHDRAWAL) {
    return send(res, 400, { success: false, message: `Minimum withdrawal is ${MIN_WITHDRAWAL} coins` });
  }
  if (!['easypaisa', 'jazzcash', 'bank'].includes(method)) {
    return send(res, 400, { success: false, message: 'Invalid payment method' });
  }
  if (!account) return send(res, 400, { success: false, message: 'Payment account is required' });

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const locked = await client.query(
      'SELECT id, coins FROM users WHERE id = $1 FOR UPDATE', [user.id]
    );
    if (!locked.rows.length) {
      await client.query('ROLLBACK');
      return send(res, 404, { success: false, message: 'User not found' });
    }

    const pending = await client.query(
      "SELECT id FROM withdrawals WHERE user_id = $1 AND status = 'pending' LIMIT 1",
      [user.id]
    );
    if (pending.rows.length) {
      await client.query('ROLLBACK');
      return send(res, 409, { success: false, message: 'You already have a pending withdrawal' });
    }

    const wallet = await client.query(
      `UPDATE wallets SET balance = COALESCE(balance,0) - $1, updated_at = NOW()
       WHERE user_id = $2 AND COALESCE(balance,0) >= $1
       RETURNING id, user_id, balance, total_earned, total_withdrawn, created_at, updated_at`,
      [amount, user.id]
    );
    if (!wallet.rows.length) {
      await client.query('ROLLBACK');
      return send(res, 400, { success: false, message: 'Insufficient balance' });
    }

    const changed = await client.query(
      'UPDATE users SET coins = COALESCE(coins,0) - $1 WHERE id = $2 AND COALESCE(coins,0) >= $1 RETURNING id',
      [amount, user.id]
    );
    if (!changed.rows.length) {
      await client.query('ROLLBACK');
      return send(res, 400, { success: false, message: 'User balance is insufficient' });
    }

    const withdrawal = await client.query(
      `INSERT INTO withdrawals
       (user_id, amount, payment_method, payment_account, status, admin_note, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'pending',NULL,NOW(),NOW())
       RETURNING id,user_id,amount,payment_method,payment_account,status,admin_note,created_at,updated_at,reviewed_at`,
      [user.id, amount, method, account]
    );

    await client.query('COMMIT');
    return send(res, 201, {
      success: true,
      message: 'Withdrawal request submitted',
      withdrawal: withdrawal.rows[0],
      wallet: walletResponse(wallet.rows[0])
    });
  } catch (error) {
    if (client) try { await client.query('ROLLBACK'); } catch {}
    console.error('WITHDRAWAL ERROR:', error);
    return send(res, 500, { success: false, message: 'Withdrawal request failed' });
  } finally {
    if (client) client.release();
  }
}

async function getAdmin(req) {
  const user = await getUserFromToken(req);
  return user && user.role === 'admin' ? user : null;
}

async function handleAdminStats(req, res) {
  const admin = await getAdmin(req);
  if (!admin) return send(res, 403, { success: false, message: 'Admin access required' });

  try {
    const [users, coins, approved, pending, kyc, referrals] = await Promise.all([
      sql`SELECT COUNT(*)::int AS count FROM users`,
      sql`SELECT COALESCE(SUM(balance),0)::bigint AS total FROM wallets`,
      sql`SELECT COUNT(*)::int AS count FROM withdrawals WHERE status='approved'`,
      sql`SELECT COUNT(*)::int AS count FROM withdrawals WHERE status='pending'`,
      sql`SELECT COUNT(*)::int AS count FROM kyc_submissions WHERE status='pending'`,
      sql`SELECT COUNT(*)::int AS count FROM users WHERE referred_by IS NOT NULL`
    ]);
    return send(res, 200, {
      success: true,
      stats: {
        totalUsers: Number(users[0].count || 0),
        totalCoins: Number(coins[0].total || 0),
        totalWithdrawals: Number(approved[0].count || 0),
        pendingWithdrawals: Number(pending[0].count || 0),
        pendingKyc: Number(kyc[0].count || 0),
        totalReferrals: Number(referrals[0].count || 0)
      }
    });
  } catch (error) {
    console.error('ADMIN STATS ERROR:', error);
    return send(res, 500, { success: false, message: 'Admin stats failed' });
  }
}

async function handleAdminUsers(req, res, body) {
  const admin = await getAdmin(req);
  if (!admin) return send(res, 403, { success: false, message: 'Admin access required' });

  try {
    if (req.method === 'GET') {
      const users = await sql`
        SELECT id,name,username,email,phone,role,coins,created_at,
               referral_code,referred_by,status
        FROM users ORDER BY created_at DESC
      `;
      return send(res, 200, { success: true, users });
    }

    const id = String(body.id || '').trim();
    const action = String(body.action || '').toLowerCase();
    const statuses = { block: 'blocked', disable: 'disabled', unblock: 'active', enable: 'active' };
    if (!id || !statuses[action]) return send(res, 400, { success: false, message: 'Invalid user action' });
    if (String(id) === String(admin.id)) return send(res, 400, { success: false, message: 'Admin account cannot be modified' });

    const rows = await sql`
      UPDATE users SET status = ${statuses[action]}
      WHERE id = ${id} AND role <> 'admin'
      RETURNING id,name,username,email,phone,role,coins,created_at,
                referral_code,referred_by,status
    `;
    if (!rows.length) return send(res, 404, { success: false, message: 'User not found or cannot be modified' });
    if (statuses[action] !== 'active') {
      await sql`DELETE FROM admin_sessions WHERE user_id = ${id}`;
    }
    return send(res, 200, { success: true, message: `User ${statuses[action]}`, user: rows[0] });
  } catch (error) {
    console.error('ADMIN USERS ERROR:', error);
    return send(res, 500, { success: false, message: 'Admin users operation failed' });
  }
}

async function handleAdminKyc(req, res, body) {
  const admin = await getAdmin(req);
  if (!admin) return send(res, 403, { success: false, message: 'Admin access required' });

  try {
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT k.*, u.name AS user_name, u.username, u.email, u.phone
        FROM kyc_submissions k LEFT JOIN users u ON u.id = k.user_id
        ORDER BY k.submitted_at DESC
      `;
      return send(res, 200, { success: true, kyc: rows });
    }

    const id = body.id;
    const action = String(body.action || '').toLowerCase();
    const note = String(body.note || '').trim();
    if (!id || !['approve', 'reject'].includes(action)) {
      return send(res, 400, { success: false, message: 'Invalid KYC action' });
    }
    const rows = await sql`
      UPDATE kyc_submissions
      SET status = ${action === 'approve' ? 'approved' : 'rejected'},
          admin_note = ${note || null}, reviewed_at = NOW()
      WHERE id = ${id} AND status = 'pending'
      RETURNING *
    `;
    if (!rows.length) return send(res, 404, { success: false, message: 'Pending KYC record not found' });
    return send(res, 200, { success: true, message: `KYC ${action}d successfully`, kyc: rows[0] });
  } catch (error) {
    console.error('ADMIN KYC ERROR:', error);
    return send(res, 500, { success: false, message: 'Admin KYC operation failed' });
  }
}

async function handleAdminWithdrawals(req, res, body) {
  const admin = await getAdmin(req);
  if (!admin) return send(res, 403, { success: false, message: 'Admin access required' });

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT w.*, u.name AS user_name, u.username, u.email
        FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id
        ORDER BY w.created_at DESC
      `;
      return send(res, 200, { success: true, withdrawals: rows });
    } catch (error) {
      console.error('ADMIN WITHDRAWALS ERROR:', error);
      return send(res, 500, { success: false, message: 'Could not load withdrawals' });
    }
  }

  const id = body.id;
  const action = String(body.action || '').toLowerCase();
  const note = String(body.note || '').trim();
  if (!id || !['approve', 'reject'].includes(action)) {
    return send(res, 400, { success: false, message: 'Invalid withdrawal action' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const found = await client.query('SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE', [id]);
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return send(res, 404, { success: false, message: 'Withdrawal not found' });
    }
    const w = found.rows[0];
    if (w.status !== 'pending') {
      await client.query('ROLLBACK');
      return send(res, 409, { success: false, message: 'Withdrawal already reviewed' });
    }

    if (action === 'approve') {
      const updatedWallet = await client.query(
        `UPDATE wallets SET total_withdrawn=COALESCE(total_withdrawn,0)+$1,
         updated_at=NOW() WHERE user_id=$2 RETURNING id`,
        [Number(w.amount), w.user_id]
      );
      if (!updatedWallet.rows.length) throw new Error('Wallet not found');
    } else {
      const updatedWallet = await client.query(
        `UPDATE wallets SET balance=COALESCE(balance,0)+$1, updated_at=NOW()
         WHERE user_id=$2 RETURNING id`,
        [Number(w.amount), w.user_id]
      );
      if (!updatedWallet.rows.length) throw new Error('Wallet not found');
      await client.query(
        'UPDATE users SET coins=COALESCE(coins,0)+$1 WHERE id=$2',
        [Number(w.amount), w.user_id]
      );
    }

    const updated = await client.query(
      `UPDATE withdrawals SET status=$1, admin_note=$2, reviewed_at=NOW(), updated_at=NOW()
       WHERE id=$3 AND status='pending' RETURNING *`,
      [action === 'approve' ? 'approved' : 'rejected', note || null, id]
    );
    if (!updated.rows.length) throw new Error('Withdrawal status update failed');

    await client.query('COMMIT');
    return send(res, 200, {
      success: true,
      message: action === 'approve' ? 'Withdrawal approved successfully' : 'Withdrawal rejected and coins returned',
      withdrawal: updated.rows[0]
    });
  } catch (error) {
    if (client) try { await client.query('ROLLBACK'); } catch {}
    console.error('ADMIN WITHDRAWALS ERROR:', error);
    return send(res, 500, { success: false, message: 'Admin withdrawal operation failed' });
  } finally {
    if (client) client.release();
  }
}

async function handleAdGemPostback(req, res) {
  if (req.method !== 'GET') {
    return send(res, 405, {
      success: false,
      message: 'AdGem postback requires GET'
    });
  }

  const secret = process.env.ADGEM_POSTBACK_KEY;
  if (!secret) {
    console.error('ADGEM_POSTBACK_KEY is not configured');
    return send(res, 503, {
      success: false,
      message: 'AdGem postback is not configured'
    });
  }

  try {
    const host = req.headers.host;
    const forwardedProto = String(
      req.headers['x-forwarded-proto'] || 'https'
    ).split(',')[0].trim();

    if (!host || !['https', 'http'].includes(forwardedProto)) {
      return send(res, 400, {
        success: false,
        message: 'Invalid postback URL'
      });
    }

    const requestUrl = new URL(
      `${forwardedProto}://${host}${req.url}`
    );

    const verifier = requestUrl.searchParams.get('verifier');
    const requestId = requestUrl.searchParams.get('request_id');

    if (!verifier || !requestId) {
      return send(res, 422, {
        success: false,
        message: 'Missing AdGem verification parameters'
      });
    }

    // Match AdGem GET verification:
    // HMAC-SHA256 of the full URL after removing verifier.
    requestUrl.searchParams.delete('verifier');

    const expectedVerifier = crypto
      .createHmac('sha256', secret)
      .update(requestUrl.href)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedVerifier, 'utf8');
    const receivedBuffer = Buffer.from(verifier, 'utf8');

    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      console.error('AdGem postback verifier failed');
      return send(res, 403, {
        success: false,
        message: 'Invalid AdGem verifier'
      });
    }

    const playerId = String(
      requestUrl.searchParams.get('player_id') || ''
    ).trim();

    const transactionId = String(
      requestUrl.searchParams.get('transaction_id') || ''
    ).trim();

    const amountText = requestUrl.searchParams.get('amount');
    const amount = Number(amountText);

    const offerId = requestUrl.searchParams.get('offer_id') || '';
    const goalId = requestUrl.searchParams.get('goal_id') || '';
    const goalName = requestUrl.searchParams.get('goal_name') || '';
    const payoutText = requestUrl.searchParams.get('payout');
    const payout = payoutText === null ? null : Number(payoutText);

    if (
      !playerId ||
      !transactionId ||
      transactionId.length > 200 ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      (payout !== null && (!Number.isFinite(payout) || payout < 0))
    ) {
      return send(res, 422, {
        success: false,
        message: 'Invalid AdGem conversion data'
      });
    }

    // Create a permanent transaction record with a unique transaction ID.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS adgem_transactions (
        transaction_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount BIGINT NOT NULL,
        offer_id TEXT,
        goal_id TEXT,
        goal_name TEXT,
        payout NUMERIC,
        request_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // player_id should be the EarnNest user ID or username.
      const userResult = await client.query(
        `SELECT id FROM users
         WHERE id = $1 OR LOWER(username) = LOWER($1)
         LIMIT 1 FOR UPDATE`,
        [playerId]
      );

      if (!userResult.rows.length) {
        await client.query('ROLLBACK');
        return send(res, 422, {
          success: false,
          message: 'EarnNest player not found'
        });
      }

      const userId = userResult.rows[0].id;

      // Duplicate transaction IDs cannot receive coins twice.
      const inserted = await client.query(
        `INSERT INTO adgem_transactions
          (transaction_id, user_id, amount, offer_id,
           goal_id, goal_name, payout, request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (transaction_id) DO NOTHING
         RETURNING transaction_id`,
        [
          transactionId,
          userId,
          amount,
          offerId,
          goalId,
          goalName,
          payout,
          requestId
        ]
      );

      if (!inserted.rows.length) {
        await client.query('ROLLBACK');
        // Already processed: return success so AdGem does not retry.
        return send(res, 200, {
          success: true,
          duplicate: true,
          message: 'Transaction already processed'
        });
      }

      await client.query(
        `INSERT INTO wallets
          (user_id, balance, total_earned, total_withdrawn)
         VALUES ($1, 0, 0, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );

      await client.query(
        `UPDATE users
         SET coins = COALESCE(coins, 0) + $1
         WHERE id = $2`,
        [amount, userId]
      );

      const walletUpdate = await client.query(
        `UPDATE wallets
         SET balance = COALESCE(balance, 0) + $1,
             total_earned = COALESCE(total_earned, 0) + $1,
             updated_at = NOW()
         WHERE user_id = $2
         RETURNING id`,
        [amount, userId]
      );

      if (!walletUpdate.rows.length) {
        throw new Error('Could not update EarnNest wallet');
      }

      await client.query('COMMIT');

      console.log('AdGem reward credited:', {
        transactionId,
        userId,
        amount
      });

      return send(res, 200, {
        success: true,
        message: 'AdGem reward credited',
        amount
      });
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('ADGEM POSTBACK ERROR:', error);
    return send(res, 500, {
      success: false,
      message: 'AdGem postback processing failed'
    });
  }
}
function normalizePath(req) {
  const path = String(req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  return path;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { success: true });

  if (!sql || !pool) {
    return send(res, 500, { success: false, message: 'DATABASE_URL is not configured' });
  }

  try {
    const path = normalizePath(req);
    const adminRoutes = {
      '/api/admin/stats': handleAdminStats,
      '/admin/stats': handleAdminStats,
      '/api/admin/users': handleAdminUsers,
      '/admin/users': handleAdminUsers,
      '/api/admin/kyc': handleAdminKyc,
      '/admin/kyc': handleAdminKyc,
      '/api/admin/withdrawals': handleAdminWithdrawals,
      '/admin/withdrawals': handleAdminWithdrawals
    };

    if (adminRoutes[path]) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      if (!['GET', 'POST'].includes(req.method)) {
        return send(res, 405, { success: false, message: 'Method not allowed' });
      }
      return await adminRoutes[path](req, res, body);
    }

    if (!['GET', 'POST'].includes(req.method)) {
      return send(res, 405, { success: false, message: 'Method not allowed' });
    }

    let body = {};
    if (req.method === 'POST') body = await readBody(req);

    const action = String(
      body.action || (req.method === 'GET' ? new URL(req.url, 'http://localhost').searchParams.get('action') : '') || ''
    ).trim().toLowerCase();

    switch (action) {
      case 'login':
        return await handleLogin(req, res, body);
      case 'register':
      case 'signup':
        return await handleRegister(req, res, body);
      case 'dashboard':
        return await handleDashboard(req, res);
      case 'wallet':
        return await handleWallet(req, res);
      case 'claim_reward':
        return await handleClaimReward(req, res, body);
      case 'daily_bonus':
        return await handleDailyBonus(req, res);
      case 'referral':
      case 'referrals':
      case 'referral_stats':
        return await handleReferral(req, res);
      case 'kyc_status':
        return await handleKycStatus(req, res);
      case 'submit_kyc':
        return await handleSubmitKyc(req, res, body);
      case 'withdraw':
        return await handleWithdrawal(req, res, body);
      case 'logout':
        return await handleLogout(req, res);
      case 'admin_stats':
        return await handleAdminStats(req, res);
      case 'admin_users':
        return await handleAdminUsers(req, res, body);
      case 'admin_kyc':
        return await handleAdminKyc(req, res, body);
      case 'admin_withdrawals':
        return await handleAdminWithdrawals(req, res, body);
      case 'health':
        await sql`SELECT 1`;
        return send(res, 200, { ok: true, success: true, service: 'EarnNest API', status: 'running', database: 'connected' });
      default:
        if (path === '/api' || path === '/api/index' || path === '/action' || path === '/') {
          return send(res, 200, { success: true, service: 'EarnNest API', message: 'API is running' });
        }
        return send(res, 404, { success: false, message: 'API route not found' });
    }
  } catch (error) {
    console.error('API ERROR:', error);
    const status = error.message === 'Invalid JSON body' ? 400 : 500;
    return send(res, status, {
      success: false,
      message: status === 400 ? 'Request body must be valid JSON' : 'Server error'
    });
  }
};
