'use strict';

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  res.end(JSON.stringify(data));
}

function getToken(req) {
  const auth = req.headers.authorization || '';

  if (!auth.startsWith('Bearer ')) {
    return '';
  }

  return auth.slice(7).trim();
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

const SURVEYS = {
  'quick-opinion': {
    title: 'Quick Opinion Survey',
    reward: 150
  },

  'shopping-survey': {
    title: 'Shopping Survey',
    reward: 300
  },

  'technology-survey': {
    title: 'Technology Survey',
    reward: 250
  },

  /*
   * Compatibility IDs in case the dashboard
   * is using survey1, survey2 or survey3.
   */
  'survey1': {
    title: 'Quick Opinion Survey',
    reward: 150
  },

  'survey2': {
    title: 'Shopping Survey',
    reward: 300
  },

  'survey3': {
    title: 'Technology Survey',
    reward: 250
  }
};

function getPeriodKey() {
  const now = new Date();

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');

  return `day:${year}-${month}-${day}`;
}

async function getUserFromToken(token) {
  if (!token) {
    return null;
  }

  const rows = await sql`
    SELECT
      s.user_id,
      s.token,
      s.expires_at,
      u.id,
      u.name,
      u.username,
      u.email
    FROM admin_sessions s
    LEFT JOIN users u
      ON u.id::text = s.user_id::text
    WHERE s.token = ${token}
      AND (
        s.expires_at IS NULL
        OR s.expires_at > NOW()
      )
    LIMIT 1
  `;

  if (!rows.length) {
    return null;
  }

  return rows[0];
}

async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS survey_claims (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      survey_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      reward INTEGER NOT NULL,
      claimed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, survey_id, period_key)
    )
  `;
}

async function ensureWallet(userId) {
  const existing = await sql`
    SELECT
      user_id,
      balance,
      total_earned,
      total_withdrawn
    FROM wallets
    WHERE user_id::text = ${String(userId)}
    LIMIT 1
  `;

  if (existing.length) {
    return existing[0];
  }

  await sql`
    INSERT INTO wallets (
      user_id,
      balance,
      total_earned,
      total_withdrawn
    )
    VALUES (
      ${String(userId)},
      0,
      0,
      0
    )
    ON CONFLICT DO NOTHING
  `;

  const created = await sql`
    SELECT
      user_id,
      balance,
      total_earned,
      total_withdrawn
    FROM wallets
    WHERE user_id::text = ${String(userId)}
    LIMIT 1
  `;

  return created[0] || null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return send(res, 200, { success: true });
  }

  if (req.method !== 'POST') {
    return send(res, 405, {
      success: false,
      message: 'Method not allowed'
    });
  }

  try {
    if (!process.env.DATABASE_URL) {
      return send(res, 500, {
        success: false,
        message: 'DATABASE_URL is not configured'
      });
    }

    const token = getToken(req);

    if (!token) {
      return send(res, 401, {
        success: false,
        message: 'Authorization token required'
      });
    }

    const user = await getUserFromToken(token);

    if (!user) {
      return send(res, 401, {
        success: false,
        message: 'Invalid or expired login session'
      });
    }

    const body = await readBody(req);

    const surveyId = String(
      body.surveyId ||
      body.survey_id ||
      body.id ||
      ''
    ).trim();

    if (!surveyId) {
      return send(res, 400, {
        success: false,
        message: 'Survey ID is required'
      });
    }

    const survey = SURVEYS[surveyId];

    if (!survey) {
      return send(res, 400, {
        success: false,
        message: `Invalid survey: ${surveyId}`
      });
    }

    await ensureTables();

    const userId = String(user.user_id);
    const periodKey = getPeriodKey();

    const alreadyClaimed = await sql`
      SELECT id
      FROM survey_claims
      WHERE user_id = ${userId}
        AND survey_id = ${surveyId}
        AND period_key = ${periodKey}
      LIMIT 1
    `;

    if (alreadyClaimed.length) {
      return send(res, 409, {
        success: false,
        message: 'This survey has already been completed today',
        alreadyClaimed: true
      });
    }

    const wallet = await ensureWallet(userId);

    if (!wallet) {
      return send(res, 500, {
        success: false,
        message: 'Wallet could not be created'
      });
    }

    const claim = await sql`
      INSERT INTO survey_claims (
        user_id,
        survey_id,
        period_key,
        reward
      )
      VALUES (
        ${userId},
        ${surveyId},
        ${periodKey},
        ${survey.reward}
      )
      ON CONFLICT (
        user_id,
        survey_id,
        period_key
      )
      DO NOTHING
      RETURNING id
    `;

    if (!claim.length) {
      return send(res, 409, {
        success: false,
        message: 'This survey has already been completed today',
        alreadyClaimed: true
      });
    }

    const updatedWallet = await sql`
      UPDATE wallets
      SET
        balance = COALESCE(balance, 0) + ${survey.reward},
        total_earned = COALESCE(total_earned, 0) + ${survey.reward}
      WHERE user_id::text = ${userId}
      RETURNING
        balance,
        total_earned,
        total_withdrawn
    `;

    if (!updatedWallet.length) {
      return send(res, 500, {
        success: false,
        message: 'Wallet update failed'
      });
    }

    try {
      await sql`
        UPDATE users
        SET coins = ${Number(updatedWallet[0].balance)}
        WHERE id::text = ${userId}
      `;
    } catch (error) {
      console.log('users.coins sync skipped:', error.message);
    }

    return send(res, 200, {
      success: true,
      message: `${survey.title} completed successfully`,
      survey: {
        id: surveyId,
        title: survey.title,
        reward: survey.reward
      },
      wallet: {
        balance: Number(updatedWallet[0].balance || 0),
        totalEarned: Number(updatedWallet[0].total_earned || 0),
        totalWithdrawn: Number(
          updatedWallet[0].total_withdrawn || 0
        )
      }
    });

  } catch (error) {
    console.error('SURVEY COMPLETE ERROR:', error);

    return send(res, 500, {
      success: false,
      message: 'Unable to process reward',
      error: error.message || 'Unknown server error'
    });
  }
};
