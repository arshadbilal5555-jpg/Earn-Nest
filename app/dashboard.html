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
  }
};

module.exports = async (req, res) => {

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
      message: 'Method not allowed. Use POST.'
    });
  }

  try {

    // Authentication
    const token = getToken(req);

    if (!token) {
      return send(res, 401, {
        success: false,
        message: 'Authentication required'
      });
    }

    // Read request
    const body = await readBody(req);

    const surveyId =
      String(body.surveyId || '').trim();

    if (!surveyId) {
      return send(res, 400, {
        success: false,
        message: 'Survey ID is required'
      });
    }

    // Check survey
    const survey = SURVEYS[surveyId];

    if (!survey) {
      return send(res, 400, {
        success: false,
        message: 'Invalid survey'
      });
    }

    // Find logged-in user
    const sessionRows = await sql`
      SELECT user_id
      FROM admin_sessions
      WHERE token = ${token}
        AND expires_at > NOW()
      LIMIT 1
    `;

    if (!sessionRows.length) {
      return send(res, 401, {
        success: false,
        message: 'Invalid or expired session'
      });
    }

    const userId =
      String(sessionRows[0].user_id);

    // Create survey completion table
    await sql`
      CREATE TABLE IF NOT EXISTS survey_completions (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        survey_id TEXT NOT NULL,
        reward INTEGER NOT NULL,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, survey_id)
      )
    `;

    // Make sure old BIGINT version is converted to TEXT
    try {
      await sql`
        ALTER TABLE survey_completions
        ALTER COLUMN user_id TYPE TEXT
        USING user_id::TEXT
      `;
    } catch (error) {
      console.log(
        'survey_completions user_id type:',
        error.message
      );
    }

    // Check duplicate
    const existing = await sql`
      SELECT id
      FROM survey_completions
      WHERE user_id = ${userId}
        AND survey_id = ${surveyId}
      LIMIT 1
    `;

    if (existing.length) {
      return send(res, 409, {
        success: false,
        message: 'Survey already completed'
      });
    }

    // Make sure wallet exists
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

    // Record completion
    await sql`
      INSERT INTO survey_completions (
        user_id,
        survey_id,
        reward
      )
      VALUES (
        ${userId},
        ${surveyId},
        ${survey.reward}
      )
    `;

    // Add reward to wallet
    const walletResult = await sql`
      UPDATE wallets
      SET
        balance =
          COALESCE(balance, 0) + ${survey.reward},

        total_earned =
          COALESCE(total_earned, 0) + ${survey.reward}

      WHERE user_id = ${userId}

      RETURNING
        balance,
        total_earned,
        total_withdrawn
    `;

    if (!walletResult.length) {

      await sql`
        DELETE FROM survey_completions
        WHERE user_id = ${userId}
          AND survey_id = ${surveyId}
      `;

      return send(res, 500, {
        success: false,
        message: 'Wallet not found'
      });
    }

    const wallet = walletResult[0];

    return send(res, 200, {
      success: true,

      message:
        `${survey.title} completed successfully`,

      survey: {
        id: surveyId,
        title: survey.title,
        reward: survey.reward
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
      'Survey completion API error:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Server error'
    });
  }
};
