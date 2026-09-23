'use strict';

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

function getToken(req) {
  const auth = req.headers.authorization || '';

  return auth.startsWith('Bearer ')
    ? auth.slice(7).trim()
    : '';
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

const TASKS = {
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

module.exports = async (req, res) => {

  // CORS preflight
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

  // Only POST allowed
  if (req.method !== 'POST') {
    return send(res, 405, {
      success: false,
      message: 'Method not allowed. Use POST.'
    });
  }

  try {

    // -----------------------------------------
    // Authentication
    // -----------------------------------------

    const token = getToken(req);

    if (!token) {
      return send(res, 401, {
        success: false,
        message: 'Authentication required'
      });
    }

    // -----------------------------------------
    // Read request body
    // -----------------------------------------

    const body = await readBody(req);

    const taskId = String(
      body.taskId || ''
    ).trim();

    if (!taskId || !TASKS[taskId]) {
      return send(res, 400, {
        success: false,
        message: 'Invalid task'
      });
    }

    const task = TASKS[taskId];

    // -----------------------------------------
    // Find logged-in user
    // -----------------------------------------

    const sessionRows = await sql`
      SELECT
        s.user_id
      FROM admin_sessions s
      WHERE s.token = ${token}
        AND s.expires_at > NOW()
      LIMIT 1
    `;

    if (!sessionRows.length) {
      return send(res, 401, {
        success: false,
        message: 'Invalid or expired session'
      });
    }

    const userId = String(
      sessionRows[0].user_id
    );

    // -----------------------------------------
    // Create task_claims table
    // user_id MUST be TEXT because
    // EarnNest user IDs are UUID-style strings.
    // -----------------------------------------

    await sql`
      CREATE TABLE IF NOT EXISTS task_claims (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        period_key TEXT NOT NULL,
        reward INTEGER NOT NULL,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, task_id, period_key)
      )
    `;

    // -----------------------------------------
    // Fix old BIGINT column if the table was
    // previously created with BIGINT.
    // -----------------------------------------

    try {
      await sql`
        ALTER TABLE task_claims
        ALTER COLUMN user_id TYPE TEXT
        USING user_id::TEXT
      `;
    } catch (alterError) {
      // Ignore if the column is already TEXT
      // or PostgreSQL does not need the change.
      console.log(
        'task_claims user_id type check:',
        alterError.message
      );
    }

    // -----------------------------------------
    // Calculate claim period
    // -----------------------------------------

    let periodKey;

    if (task.period === 'once') {

      periodKey = 'once';

    } else if (task.period === 'daily') {

      const today = new Date()
        .toISOString()
        .slice(0, 10);

      periodKey = `day:${today}`;

    } else if (task.period === 'weekly') {

      const now = new Date();

      const date = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate()
        )
      );

      const day = date.getUTCDay() || 7;

      date.setUTCDate(
        date.getUTCDate() + 4 - day
      );

      const yearStart = new Date(
        Date.UTC(
          date.getUTCFullYear(),
          0,
          1
        )
      );

      const weekNumber = Math.ceil(
        (
          (
            (date - yearStart) / 86400000
          ) + 1
        ) / 7
      );

      periodKey =
        `week:${date.getUTCFullYear()}-W${String(
          weekNumber
        ).padStart(2, '0')}`;

    } else {

      return send(res, 400, {
        success: false,
        message: 'Invalid task period'
      });

    }

    // -----------------------------------------
    // Check if already claimed
    // -----------------------------------------

    const existingClaim = await sql`
      SELECT id
      FROM task_claims
      WHERE user_id = ${userId}
        AND task_id = ${taskId}
        AND period_key = ${periodKey}
      LIMIT 1
    `;

    if (existingClaim.length) {

      const walletRows = await sql`
        SELECT
          balance,
          total_earned,
          total_withdrawn
        FROM wallets
        WHERE user_id = ${userId}
        LIMIT 1
      `;

      return send(res, 409, {
        success: false,
        message: 'Task already claimed for this period',
        wallet: walletRows.length
          ? {
              balance: Number(
                walletRows[0].balance || 0
              ),
              totalEarned: Number(
                walletRows[0].total_earned || 0
              ),
              totalWithdrawn: Number(
                walletRows[0].total_withdrawn || 0
              )
            }
          : null
      });
    }

    // -----------------------------------------
    // Make sure wallet exists
    // -----------------------------------------

    await sql`
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
      ON CONFLICT (user_id)
      DO NOTHING
    `;

    // -----------------------------------------
    // Add task claim
    // -----------------------------------------

    await sql`
      INSERT INTO task_claims (
        user_id,
        task_id,
        period_key,
        reward
      )
      VALUES (
        ${userId},
        ${taskId},
        ${periodKey},
        ${task.reward}
      )
    `;

    // -----------------------------------------
    // Add reward to wallet
    // -----------------------------------------

    const walletResult = await sql`
      UPDATE wallets
      SET
        balance = COALESCE(balance, 0)
          + ${task.reward},

        total_earned = COALESCE(total_earned, 0)
          + ${task.reward}

      WHERE user_id = ${userId}

      RETURNING
        balance,
        total_earned,
        total_withdrawn
    `;

    if (!walletResult.length) {

      // If wallet update failed, remove claim
      // so the user can try again.
      await sql`
        DELETE FROM task_claims
        WHERE user_id = ${userId}
          AND task_id = ${taskId}
          AND period_key = ${periodKey}
      `;

      return send(res, 500, {
        success: false,
        message: 'Wallet not found'
      });
    }

    const wallet = walletResult[0];

    // -----------------------------------------
    // Success
    // -----------------------------------------

    return send(res, 200, {
      success: true,

      message:
        `${task.title} completed successfully`,

      task: {
        id: taskId,
        title: task.title,
        reward: task.reward
      },

      wallet: {
        balance: Number(
          wallet.balance || 0
        ),

        totalEarned: Number(
          wallet.total_earned || 0
        ),

        totalWithdrawn: Number(
          wallet.total_withdrawn || 0
        )
      }
    });

  } catch (error) {

    console.error(
      'Task completion API error:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Server error'
    });
  }
};
