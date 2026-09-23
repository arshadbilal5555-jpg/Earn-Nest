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

/*
  Server-side task definitions.
  The reward is NEVER taken from the browser.
*/
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
    const token = getToken(req);

    if (!token) {
      return send(res, 401, {
        success: false,
        message: 'Authentication required'
      });
    }

    const body = await readBody(req);
    const taskId = String(body.taskId || '').trim();

    if (!taskId || !TASKS[taskId]) {
      return send(res, 400, {
        success: false,
        message: 'Invalid task'
      });
    }

    /*
      Find the logged-in user from the same session system
      used by profile.js and wallet.js.
    */
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

    const userId = sessionRows[0].user_id;
    const task = TASKS[taskId];

    /*
      Create a small task-claim table if it does not already exist.

      This lets us prevent:
      - duplicate one-time claims
      - multiple daily claims
      - multiple weekly claims
    */
    await sql`
      CREATE TABLE IF NOT EXISTS task_claims (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        task_id TEXT NOT NULL,
        period_key TEXT NOT NULL,
        reward INTEGER NOT NULL,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, task_id, period_key)
      )
    `;

    /*
      Determine the claim period.
    */
    let periodKey;

    if (task.period === 'once') {
      periodKey = 'once';
    } else if (task.period === 'daily') {
      periodKey = `day:${new Date().toISOString().slice(0, 10)}`;
    } else {
      /*
        ISO week key, e.g. week:2026-W39
      */
      const now = new Date();
      const date = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate()
        )
      );

      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - day);

      const yearStart = new Date(
        Date.UTC(date.getUTCFullYear(), 0, 1)
      );

      const weekNumber = Math.ceil(
        (((date - yearStart) / 86400000) + 1) / 7
      );

      periodKey =
        `week:${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
    }

    /*
      Atomically:
      1. register the claim
      2. increase wallet balance
      3. increase total earned

      If the same task/period was already claimed,
      nothing is added.
    */
    const result = await sql`
      WITH new_claim AS (
        INSERT INTO task_claims
          (user_id, task_id, period_key, reward)
        VALUES
          (${userId}, ${taskId}, ${periodKey}, ${task.reward})
        ON CONFLICT (user_id, task_id, period_key)
        DO NOTHING
        RETURNING user_id
      )
      UPDATE wallets
      SET
        balance = COALESCE(balance, 0) + ${task.reward},
        total_earned = COALESCE(total_earned, 0) + ${task.reward}
      WHERE user_id = ${userId}
        AND EXISTS (
          SELECT 1
          FROM new_claim
        )
      RETURNING
        balance,
        total_earned,
        total_withdrawn
    `;

    /*
      No wallet update means the task was already claimed
      or the wallet does not exist.
    */
    if (!result.length) {
      const walletRows = await sql`
        SELECT
          balance,
          total_earned,
          total_withdrawn
        FROM wallets
        WHERE user_id = ${userId}
        LIMIT 1
      `;

      if (!walletRows.length) {
        return send(res, 500, {
          success: false,
          message: 'Wallet not found'
        });
      }

      return send(res, 409, {
        success: false,
        message: 'Task already claimed for this period'
      });
    }

    const wallet = result[0];

    return send(res, 200, {
      success: true,
      message: `${task.title} completed successfully`,
      task: {
        id: taskId,
        title: task.title,
        reward: task.reward
      },
      wallet: {
        balance: Number(wallet.balance || 0),
        totalEarned: Number(wallet.total_earned || 0),
        totalWithdrawn: Number(wallet.total_withdrawn || 0)
      }
    });

  } catch (error) {
    console.error('Task completion API error:', error);

    return send(res, 500, {
      success: false,
      message: 'Server error'
    });
  }
};
