'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const ADMIN_EMAIL =
  (process.env.ADMIN_EMAIL || 'admin@earnnest.com').toLowerCase();

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || 'Admin@123';

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

function clean(value) {
  return String(value ?? '').trim();
}

function email(value) {
  return clean(value).toLowerCase();
}

function createToken() {
  return crypto.randomUUID();
}

function getBearer(req) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) {
    return '';
  }

  return header.slice(7).trim();
}

async function ensureAdmin() {
  await sql`
    INSERT INTO users
      (id, name, username, email, phone, password, role, coins)
    VALUES
      (
        'admin-001',
        'EarnNest Admin',
        'admin',
        ${ADMIN_EMAIL},
        '',
        ${ADMIN_PASSWORD},
        'admin',
        0
      )
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      username = EXCLUDED.username,
      role = 'admin'
  `;

  await sql`
    INSERT INTO wallets
      (user_id, balance, total_earned, total_withdrawn)
    VALUES
      ('admin-001', 0, 0, 0)
    ON CONFLICT (user_id) DO NOTHING
  `;
}

async function ensureRewardTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS reward_claims (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reference_key TEXT NOT NULL,
      title TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, reward_type, reference_key)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS reward_claims_user_idx
    ON reward_claims(user_id)
  `;
}

async function ensureWithdrawalTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      payment_method TEXT NOT NULL,
      account_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS withdrawal_requests_user_idx
    ON withdrawal_requests(user_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS withdrawal_requests_status_idx
    ON withdrawal_requests(status)
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_one_pending_per_user_idx
    ON withdrawal_requests(user_id)
    WHERE status = 'pending'
  `;
}

async function getSessionUser(req) {
  const token = getBearer(req);

  if (!token) {
    return null;
  }

  const rows = await sql`
    SELECT u.*
    FROM admin_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
    LIMIT 1
  `;

  return rows[0] || null;
}

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
        (user_id, balance, total_earned, total_withdrawn)
      VALUES
        (${userId}, 0, 0, 0)
    `;

    rows = await sql`
      SELECT *
      FROM wallets
      WHERE user_id = ${userId}
      LIMIT 1
    `;
  }

  return rows[0];
}

async function getWithdrawalSummary(userId) {
  const rows = await sql`
    SELECT
      COALESCE(
        SUM(
          CASE
            WHEN status = 'pending'
            THEN amount
            ELSE 0
          END
        ),
        0
      )::int AS pending_withdrawal,

      COALESCE(
        SUM(
          CASE
            WHEN status = 'approved'
            THEN amount
            ELSE 0
          END
        ),
        0
      )::int AS total_withdrawn

    FROM withdrawal_requests
    WHERE user_id = ${userId}
  `;

  return {
    pendingWithdrawal:
      Number(rows[0]?.pending_withdrawal || 0),

    totalWithdrawn:
      Number(rows[0]?.total_withdrawn || 0)
  };
}

async function creditReward({
  userId,
  type,
  referenceKey,
  title,
  amount
}) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Invalid reward amount');
  }

  const claimId = crypto.randomUUID();

  try {
    await sql`
      INSERT INTO reward_claims
        (
          id,
          user_id,
          reward_type,
          reference_key,
          title,
          amount
        )
      VALUES
        (
          ${claimId},
          ${userId},
          ${type},
          ${referenceKey},
          ${title},
          ${amount}
        )
    `;
  } catch (error) {
    if (error.code === '23505') {
      return {
        duplicate: true
      };
    }

    throw error;
  }

  await sql`
    UPDATE wallets
    SET
      balance = COALESCE(balance, 0) + ${amount},
      total_earned = COALESCE(total_earned, 0) + ${amount},
      updated_at = NOW()
    WHERE user_id = ${userId}
  `;

  await sql`
    UPDATE users
    SET coins = COALESCE(
      (
        SELECT balance
        FROM wallets
        WHERE user_id = ${userId}
      ),
      0
    )
    WHERE id = ${userId}
  `;

  return {
    duplicate: false,
    amount
  };
}

module.exports = async (req, res) => {

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

  const path = req.url.split('?')[0];

  try {

    /* HEALTH */

    if (
      req.method === 'GET' &&
      path === '/api/health'
    ) {
      const result = await sql`
        SELECT NOW() AS database_time
      `;

      return send(res, 200, {
        ok: true,
        success: true,
        service: 'EarnNest API',
        status: 'running',
        database: 'connected',
        databaseTime: result[0].database_time
      });
    }

    await ensureAdmin();
    await ensureRewardTable();
    await ensureWithdrawalTable();

    /* LOGIN */

    if (
      req.method === 'POST' &&
      path === '/api/login'
    ) {
      const body = await readBody(req);

      const login = email(
        body.login ||
        body.email ||
        body.username
      );

      const password = String(body.password || '');

      if (!login || !password) {
        return send(res, 400, {
          success: false,
          message:
            'Email/username and password are required'
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
          message:
            'Invalid email/username or password'
        });
      }

      const token = createToken();

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
          coins: Number(wallet?.balance || 0),
          balance: Number(wallet?.balance || 0),
          totalEarned:
            Number(wallet?.total_earned || 0),
          totalWithdrawn:
            Number(wallet?.total_withdrawn || 0)
        }
      });
    }

    /* REGISTER */

    if (
      req.method === 'POST' &&
      path === '/api/register'
    ) {
      const body = await readBody(req);

      const name = clean(body.name);

      const username =
        clean(body.username).toLowerCase();

      const userEmail =
        email(body.email);

      const phone =
        clean(body.phone);

      const password =
        String(body.password || '');

      const confirm =
        String(body.confirmPassword || '');

      if (
        !name ||
        !username ||
        !userEmail ||
        !phone ||
        !password ||
        !confirm
      ) {
        return send(res, 400, {
          success: false,
          message: 'All fields are required'
        });
      }

      if (password.length < 6) {
        return send(res, 400, {
          success: false,
          message:
            'Password must be at least 6 characters'
        });
      }

      if (password !== confirm) {
        return send(res, 400, {
          success: false,
          message:
            'Passwords do not match'
        });
      }

      const existingEmail = await sql`
        SELECT id
        FROM users
        WHERE email = ${userEmail}
        LIMIT 1
      `;

      if (existingEmail.length) {
        return send(res, 409, {
          success: false,
          message:
            'Email already registered'
        });
      }

      const existingUsername = await sql`
        SELECT id
        FROM users
        WHERE LOWER(username) = ${username}
        LIMIT 1
      `;

      if (existingUsername.length) {
        return send(res, 409, {
          success: false,
          message:
            'Username already registered'
        });
      }

      const userId =
        'user-' + crypto.randomUUID();

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
            coins
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
            0
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
          balance: 0
        }
      });
    }

    /* PROFILE */

    if (
      req.method === 'GET' &&
      path === '/api/profile'
    ) {
      const user =
        await getSessionUser(req);

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

        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          phone: user.phone,
          role: user.role,
          coins:
            Number(wallet?.balance || 0),
          balance:
            Number(wallet?.balance || 0),
          totalEarned:
            Number(wallet?.total_earned || 0),
          totalWithdrawn:
            Number(wallet?.total_withdrawn || 0)
        }
      });
    }

    /* WALLET */

    if (
      req.method === 'GET' &&
      path === '/api/wallet'
    ) {
      const user =
        await getSessionUser(req);

      if (!user) {
        return send(res, 401, {
          success: false,
          message:
            'Authentication required'
        });
      }

      const wallet =
        await getWallet(user.id);

      const withdrawal =
        await getWithdrawalSummary(user.id);

      return send(res, 200, {
        success: true,

        wallet: {
          balance:
            Number(wallet?.balance || 0),

          totalEarned:
            Number(wallet?.total_earned || 0),

          totalWithdrawn:
            withdrawal.totalWithdrawn,

          pendingWithdrawal:
            withdrawal.pendingWithdrawal
        }
      });
    }

    /* WITHDRAW */

    if (
      req.method === 'POST' &&
      path === '/api/withdraw'
    ) {
      const user =
        await getSessionUser(req);

      if (!user) {
        return send(res, 401, {
          success: false,
          message:
            'Please login first.'
        });
      }

      if (user.role === 'admin') {
        return send(res, 403, {
          success: false,
          message:
            'Admin account cannot request withdrawals.'
        });
      }

      const body =
        await readBody(req);

      const amount =
        Number(body.amount);

      const paymentMethod =
        clean(body.paymentMethod);

      const accountNumber =
        clean(body.accountNumber);

      if (
        !Number.isInteger(amount) ||
        amount < 1000
      ) {
        return send(res, 400, {
          success: false,
          message:
            'Minimum withdrawal is 1,000 Coins.'
        });
      }

      if (!paymentMethod) {
        return send(res, 400, {
          success: false,
          message:
            'Please select a payment method.'
        });
      }

      if (
        !accountNumber ||
        accountNumber.length < 5
      ) {
        return send(res, 400, {
          success: false,
          message:
            'Please enter a valid account number.'
        });
      }

      const wallet =
        await getWallet(user.id);

      const balance =
        Number(wallet?.balance || 0);

      if (balance < amount) {
        return send(res, 400, {
          success: false,
          message:
            `Insufficient balance. Your balance is ${balance} Coins.`
        });
      }

      const pending =
        await sql`
          SELECT id
          FROM withdrawal_requests
          WHERE user_id = ${user.id}
            AND status = 'pending'
          LIMIT 1
        `;

      if (pending.length) {
        return send(res, 400, {
          success: false,
          message:
            'You already have a pending withdrawal request.'
        });
      }

      const withdrawalId =
        crypto.randomUUID();

      const result =
        await sql`
          WITH deducted AS (
            UPDATE wallets
            SET
              balance =
                COALESCE(balance, 0) - ${amount},
              updated_at = NOW()
            WHERE
              user_id = ${user.id}
              AND COALESCE(balance, 0) >= ${amount}
            RETURNING balance
          )

          INSERT INTO withdrawal_requests
            (
              id,
              user_id,
              amount,
              payment_method,
              account_number,
              status,
              created_at
            )

          SELECT
            ${withdrawalId},
            ${user.id},
            ${amount},
            ${paymentMethod},
            ${accountNumber},
            'pending',
            NOW()

          FROM deducted

          RETURNING
            id,
            amount,
            payment_method,
            status,
            created_at
        `;

      if (!result.length) {
        return send(res, 400, {
          success: false,
          message:
            'Unable to process withdrawal. Please check your balance.'
        });
      }

      await sql`
        UPDATE users
        SET coins = (
          SELECT balance
          FROM wallets
          WHERE user_id = ${user.id}
        )
        WHERE id = ${user.id}
      `;

      const newWallet =
        await getWallet(user.id);

      return send(res, 200, {
        success: true,

        message:
          'Withdrawal request submitted successfully.',

        withdrawal: {
          id:
            result[0].id,

          amount:
            Number(result[0].amount),

          paymentMethod:
            result[0].payment_method,

          status:
            result[0].status,

          createdAt:
            result[0].created_at
        },

        wallet: {
          balance:
            Number(newWallet?.balance || 0)
        }
      });
    }

    /* WITHDRAWAL HISTORY */

    if (
      req.method === 'GET' &&
      path === '/api/withdrawals'
    ) {
      const user =
        await getSessionUser(req);

      if (!user) {
        return send(res, 401, {
          success: false,
          message:
            'Authentication required'
        });
      }

      const rows =
        await sql`
          SELECT
            id,
            amount,
            payment_method,
            account_number,
            status,
            created_at,
            processed_at
          FROM withdrawal_requests
          WHERE user_id = ${user.id}
          ORDER BY created_at DESC
          LIMIT 100
        `;

      return send(res, 200, {
        success: true,

        withdrawals:
          rows.map(row => ({
            id: row.id,
            amount:
              Number(row.amount || 0),
            paymentMethod:
              row.payment_method,
            accountNumber:
              row.account_number,
            status:
              row.status,
            createdAt:
              row.created_at,
            processedAt:
              row.processed_at
          }))
      });
    }

    /* TASK */

    if (
      req.method === 'POST' &&
      path === '/api/tasks/complete'
    ) {
      const user =
        await getSessionUser(req);

      if (!user) {
        return send(res, 401, {
          success: false,
          message:
            'Authentication required'
        });
      }

      if (user.role === 'admin') {
        return send(res, 403, {
          success: false,
          message:
            'Admin cannot claim user rewards'
        });
      }

      const body =
        await readBody(req);

      const taskId =
        clean(body.taskId);

      const allowedTasks = {
        'daily-checkin': {
          name: 'Daily Check-in',
          reward: 50
        },

        'complete-profile': {
          name: 'Complete Profile',
          reward: 100
        },

        'app-visit': {
          name: 'App Visit',
          reward: 25
        },

        'weekly-activity': {
          name: 'Weekly Activity',
          reward: 250
        }
      };

      const task =
        allowedTasks[taskId];

      if (!task) {
        return send(res, 400, {
          success: false,
          message:
            'Invalid task'
        });
      }

      const result =
        await creditReward({
          userId: user.id,
          type: 'task',
          referenceKey: taskId,
          title: task.name,
          amount: task.reward
        });

      if (result.duplicate) {
        return send(res, 409, {
          success: false,
          message:
            'This task has already been claimed.'
        });
      }

      const wallet =
        await getWallet(user.id);

      return send(res, 200, {
        success: true,
        message:
          'Task reward credited successfully',

        reward:
          task.reward,

        wallet: {
          balance:
            Number(wallet?.balance || 0),

          totalEarned:
            Number(wallet?.total_earned || 0)
        }
      });
    }

    /* SURVEY */

    if (
      req.method === 'POST' &&
      path === '/api/surveys/complete'
    ) {
      const user =
        await getSessionUser(req);

      if (!user) {
        return send(res, 401, {
          success: false,
          message:
            'Authentication required'
        });
      }

      const body =
        await readBody(req);

      const surveyId =
        clean(body.surveyId);

      const allowedSurveys = {
        'quick-opinion': {
          name: 'Quick Opinion Survey',
          reward: 150
        },

        'shopping-survey': {
          name: 'Shopping Survey',
          reward: 300
        },

        'technology-survey': {
          name: 'Technology Survey',
          reward: 250
        }
      };

      const survey =
        allowedSurveys[surveyId];

      if (!survey) {
        return send(res, 400, {
          success: false,
          message:
            'Invalid survey'
        });
      }

      const result =
        await creditReward({
          userId: user.id,
          type: 'survey',
          referenceKey: surveyId,
          title: survey.name,
          amount: survey.reward
        });

      if (result.duplicate) {
        return send(res, 409, {
          success: false,
          message:
            'This survey has already been completed.'
        });
      }

      const wallet =
        await getWallet(user.id);

      return send(res, 200, {
        success: true,
        message:
          'Survey reward credited successfully',

        reward:
          survey.reward,

        wallet: {
          balance:
            Number(wallet?.balance || 0),

          totalEarned:
            Number(wallet?.total_earned || 0)
        }
      });
    }

    /* DAILY BONUS */

    if (
      req.method === 'POST' &&
      path === '/api/daily-bonus'
    ) {
      const user =
        await getSessionUser(req);

      if (!user) {
        return send(res, 401, {
          success: false,
          message:
            'Authentication required'
        });
      }

      const today =
        new Date()
          .toISOString()
          .slice(0, 10);

      const result =
        await creditReward({
          userId: user.id,
          type: 'daily_bonus',
          referenceKey: today,
          title: 'Daily Bonus',
          amount: 50
        });

      if (result.duplicate) {
        return send(res, 409, {
          success: false,
          message:
            'Today’s bonus has already been claimed.'
        });
      }

      const wallet =
        await getWallet(user.id);

      return send(res, 200, {
        success: true,
        message:
          'Daily bonus credited successfully',

        reward: 50,

        wallet: {
          balance:
            Number(wallet?.balance || 0),

          totalEarned:
            Number(wallet?.total_earned || 0)
        }
      });
    }

    /* EARNINGS */

    if (
      req.method === 'GET' &&
      path === '/api/earnings'
    ) {
      const user =
        await getSessionUser(req);

      if (!user) {
        return send(res, 401, {
          success: false,
          message:
            'Authentication required'
        });
      }

      const rows =
        await sql`
          SELECT
            id,
            reward_type,
            title,
            amount,
            created_at
          FROM reward_claims
          WHERE user_id = ${user.id}
          ORDER BY created_at DESC
          LIMIT 100
        `;

      return send(res, 200, {
        success: true,

        earnings:
          rows.map(row => ({
            id:
              row.id,

            type:
              row.reward_type,

            name:
              row.title,

            reward:
              Number(row.amount || 0),

            date:
              row.created_at
          }))
      });
    }

    /* ADMIN STATS */

    if (
      req.method === 'GET' &&
      path === '/api/admin/stats'
    ) {
      const admin =
        await getSessionUser(req);

      if (!admin || admin.role !== 'admin') {
        return send(res, 403, {
          success: false,
          message:
            'Admin access required'
        });
      }

      const users =
        await sql`
          SELECT
            id,
            name,
            username,
            email,
            phone,
            role,
            coins,
            created_at
          FROM users
          WHERE role != 'admin'
          ORDER BY created_at DESC
        `;

      const totals =
        await sql`
          SELECT
            COUNT(*)::int AS total_users,
            COALESCE(
              SUM(coins),
              0
            )::int AS total_coins
          FROM users
          WHERE role != 'admin'
        `;

      const withdrawals =
        await sql`
          SELECT
            COUNT(*)::int AS total_withdrawals
          FROM withdrawal_requests
        `;

      const pendingWithdrawals =
        await sql`
          SELECT
            COUNT(*)::int AS pending_withdrawals
          FROM withdrawal_requests
          WHERE status = 'pending'
        `;

      const pendingKyc =
        await sql`
          SELECT
            COUNT(*)::int AS pending_kyc
          FROM kyc_submissions
          WHERE status = 'pending'
        `;

      return send(res, 200, {
        success: true,

        stats: {
          totalUsers:
            Number(
              totals[0]?.total_users || 0
            ),

          totalCoins:
            Number(
              totals[0]?.total_coins || 0
            ),

          totalWithdrawals:
            Number(
              withdrawals[0]?.total_withdrawals || 0
            ),

          pendingWithdrawals:
            Number(
              pendingWithdrawals[0]?.pending_withdrawals || 0
            ),

          pendingKyc:
            Number(
              pendingKyc[0]?.pending_kyc || 0
            )
        },

        users:
          users.map(user => ({
            id:
              user.id,

            name:
              user.name,

            username:
              user.username,

            email:
              user.email,

            phone:
              user.phone,

            role:
              user.role,

            coins:
              Number(user.coins || 0),

            createdAt:
              user.created_at
          }))
      });
    }

    /* ADMIN WITHDRAWALS */

    if (
      req.method === 'GET' &&
      path === '/api/admin/withdrawals'
    ) {
      const admin =
        await getSessionUser(req);

      if (!admin || admin.role !== 'admin') {
        return send(res, 403, {
          success: false,
          message:
            'Admin access required'
        });
      }

      const rows =
        await sql`
          SELECT
            w.id,
            w.user_id,
            w.amount,
            w.payment_method,
            w.account_number,
            w.status,
            w.created_at,
            w.processed_at,
            u.name,
            u.username,
            u.email
          FROM withdrawal_requests w
          JOIN users u
            ON u.id = w.user_id
          ORDER BY w.created_at DESC
          LIMIT 200
        `;

      return send(res, 200, {
        success: true,

        withdrawals:
          rows.map(row => ({
            id:
              row.id,

            userId:
              row.user_id,

            name:
              row.name,

            username:
              row.username,

            email:
              row.email,

            amount:
              Number(row.amount || 0),

            paymentMethod:
              row.payment_method,

            accountNumber:
              row.account_number,

            status:
              row.status,

            createdAt:
              row.created_at,

            processedAt:
              row.processed_at
          }))
      });
    }

    /* ADMIN APPROVE */

    if (
      req.method === 'POST' &&
      path === '/api/admin/withdrawals/approve'
    ) {
      const admin =
        await getSessionUser(req);

      if (!admin || admin.role !== 'admin') {
        return send(res, 403, {
          success: false,
          message:
            'Admin access required'
        });
      }

      const body =
        await readBody(req);

      const withdrawalId =
        clean(body.withdrawalId);

      if (!withdrawalId) {
        return send(res, 400, {
          success: false,
          message:
            'Withdrawal ID is required.'
        });
      }

      const rows =
        await sql`
          SELECT
            id,
            user_id,
            amount,
            status
          FROM withdrawal_requests
          WHERE id = ${withdrawalId}
          LIMIT 1
        `;

      if (!rows.length) {
        return send(res, 404, {
          success: false,
          message:
            'Withdrawal request not found.'
        });
      }

      const withdrawal =
        rows[0];

      if (withdrawal.status !== 'pending') {
        return send(res, 400, {
          success: false,
          message:
            'This withdrawal has already been processed.'
        });
      }

      await sql`
        UPDATE withdrawal_requests
        SET
          status = 'approved',
          processed_at = NOW()
        WHERE id = ${withdrawalId}
          AND status = 'pending'
      `;

      await sql`
        UPDATE wallets
        SET
          total_withdrawn =
            COALESCE(total_withdrawn, 0)
            + ${Number(withdrawal.amount)},
          updated_at = NOW()
        WHERE user_id = ${withdrawal.user_id}
      `;

      return send(res, 200, {
        success: true,
        message:
          'Withdrawal approved successfully.'
      });
    }

    /* ADMIN REJECT */

    if (
      req.method === 'POST' &&
      path === '/api/admin/withdrawals/reject'
    ) {
      const admin =
        await getSessionUser(req);

      if (!admin || admin.role !== 'admin') {
        return send(res, 403, {
          success: false,
          message:
            'Admin access required'
        });
      }

      const body =
        await readBody(req);

      const withdrawalId =
        clean(body.withdrawalId);

      if (!withdrawalId) {
        return send(res, 400, {
          success: false,
          message:
            'Withdrawal ID is required.'
        });
      }

      const rows =
        await sql`
          SELECT
            id,
            user_id,
            amount,
            status
          FROM withdrawal_requests
          WHERE id = ${withdrawalId}
          LIMIT 1
        `;

      if (!rows.length) {
        return send(res, 404, {
          success: false,
          message:
            'Withdrawal request not found.'
        });
      }

      const withdrawal =
        rows[0];

      if (withdrawal.status !== 'pending') {
        return send(res, 400, {
          success: false,
          message:
            'This withdrawal has already been processed.'
        });
      }

      const amount =
        Number(withdrawal.amount || 0);

      await sql`
        UPDATE withdrawal_requests
        SET
          status = 'rejected',
          processed_at = NOW()
        WHERE id = ${withdrawalId}
          AND status = 'pending'
      `;

      await sql`
        UPDATE wallets
        SET
          balance =
            COALESCE(balance, 0) + ${amount},
          updated_at = NOW()
        WHERE user_id = ${withdrawal.user_id}
      `;

      await sql`
        UPDATE users
        SET coins = (
          SELECT balance
          FROM wallets
          WHERE user_id = ${withdrawal.user_id}
        )
        WHERE id = ${withdrawal.user_id}
      `;

      return send(res, 200, {
        success: true,
        message:
          'Withdrawal rejected and balance refunded.'
      });
    }

    /* ADMIN LOGOUT */

    if (
      req.method === 'POST' &&
      path === '/api/admin/logout'
    ) {
      const token =
        getBearer(req);

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

    return send(res, 404, {
      success: false,
      message:
        'API endpoint not found'
    });

  } catch (error) {

    console.error(
      'EarnNest API error:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Server error',

      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : undefined
    });
  }
};

function readBody(req) {
  return new Promise((resolve, reject) => {

    let body = '';

    req.on('data', chunk => {

      body += chunk;

      if (body.length > 1024 * 1024) {

        reject(
          new Error('Request too large')
        );

        req.destroy();
      }
    });

    req.on('end', () => {

      if (!body) {
        return resolve({});
      }

      try {

        resolve(
          JSON.parse(body)
        );

      } catch {

        reject(
          new Error('Invalid JSON')
        );
      }
    });

    req.on('error', reject);
  });
}
