'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

const CPX_APP_ID = '36505';
const CPX_SECURE_HASH = process.env.CPX_SECURE_HASH || '';

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function md5(value) {
  return crypto
    .createHash('md5')
    .update(value)
    .digest('hex');
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

/*
 * CPX POSTBACK
 *
 * CPX sends:
 * status
 * trans_id
 * user_id
 * amount_local
 * amount_usd
 * hash
 * type
 *
 * status:
 * 1 = completed
 * 2 = canceled/fraud
 */
async function handleCPXPostback(req, res) {
  if (!CPX_SECURE_HASH) {
    console.error('CPX_SECURE_HASH is not configured');

    return send(res, 500, {
      success: false,
      message: 'CPX configuration missing'
    });
  }

  const query = req.query || {};

  const status = String(query.status || '').trim();
  const transId = String(query.trans_id || '').trim();
  const cpxUserId = String(query.user_id || '').trim();
  const amountLocal = safeNumber(query.amount_local);
  const amountUsd = safeNumber(query.amount_usd);
  const receivedHash = String(query.hash || '').trim().toLowerCase();
  const type = String(query.type || '').trim();

  if (!status || !transId || !cpxUserId || !receivedHash) {
    return send(res, 400, {
      success: false,
      message: 'Missing CPX postback parameters'
    });
  }

  const expectedHash = md5(
    `${transId}-${CPX_SECURE_HASH}`
  );

  if (
    receivedHash !== expectedHash.toLowerCase()
  ) {
    console.error('Invalid CPX hash', {
      transId,
      cpxUserId
    });

    return send(res, 403, {
      success: false,
      message: 'Invalid CPX hash'
    });
  }

  /*
   * Create a CPX transaction table.
   * transaction_id is unique so the same CPX event
   * cannot credit the wallet twice.
   */
  await sql`
    CREATE TABLE IF NOT EXISTS cpx_transactions (
      id BIGSERIAL PRIMARY KEY,
      transaction_id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      status INTEGER NOT NULL,
      type TEXT,
      amount_local NUMERIC DEFAULT 0,
      amount_usd NUMERIC DEFAULT 0,
      coins INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  /*
   * Find the real EarnNest user.
   * CPX user_id is the same value as EarnNest users.id.
   */
  const users = await sql`
    SELECT id
    FROM users
    WHERE id::text = ${cpxUserId}
    LIMIT 1
  `;

  if (!users.length) {
    return send(res, 404, {
      success: false,
      message: 'EarnNest user not found'
    });
  }

  const userId = String(users[0].id);

  /*
   * Existing transaction?
   */
  const existing = await sql`
    SELECT
      id,
      status,
      coins
    FROM cpx_transactions
    WHERE transaction_id = ${transId}
    LIMIT 1
  `;

  /*
   * CPX status 2 means canceled/fraud.
   * If a completed transaction later becomes canceled,
   * reverse the coins previously credited.
   */
  if (status === '2') {

    if (!existing.length) {
      /*
       * Nothing was credited by EarnNest, so just record
       * the cancellation.
       */
      await sql`
        INSERT INTO cpx_transactions (
          transaction_id,
          user_id,
          status,
          type,
          amount_local,
          amount_usd,
          coins
        )
        VALUES (
          ${transId},
          ${userId},
          2,
          ${type},
          ${amountLocal},
          ${amountUsd},
          0
        )
        ON CONFLICT (transaction_id)
        DO NOTHING
      `;

      return send(res, 200, {
        success: true,
        message: 'CPX cancellation recorded'
      });
    }

    const previous = existing[0];

    /*
     * Already canceled.
     */
    if (Number(previous.status) === 2) {
      return send(res, 200, {
        success: true,
        message: 'CPX cancellation already processed'
      });
    }

    const previousCoins = Number(previous.coins || 0);

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

    /*
     * Never allow wallet balance to become negative.
     */
    await sql`
      UPDATE wallets
      SET
        balance = GREATEST(
          0,
          COALESCE(balance, 0) - ${previousCoins}
        ),
        total_earned = GREATEST(
          0,
          COALESCE(total_earned, 0) - ${previousCoins}
        )
      WHERE user_id = ${userId}
    `;

    await sql`
      UPDATE cpx_transactions
      SET
        status = 2,
        updated_at = NOW()
      WHERE transaction_id = ${transId}
    `;

    return send(res, 200, {
      success: true,
      message: 'CPX cancellation processed',
      reversedCoins: previousCoins
    });
  }

  /*
   * Only CPX status 1 creates a reward.
   */
  if (status !== '1') {
    return send(res, 200, {
      success: true,
      message: 'CPX event received',
      status
    });
  }

  /*
   * Do not credit the same transaction twice.
   */
  if (existing.length) {
    return send(res, 200, {
      success: true,
      message: 'CPX transaction already processed',
      transactionId: transId
    });
  }

  /*
   * EarnNest reward:
   *
   * CPX Reward Settings were configured as:
   * 700 Coins = $1 publisher revenue
   *
   * amount_usd is CPX publisher revenue.
   */
  const coins = Math.max(
    0,
    Math.floor(amountUsd * 700)
  );

  if (coins <= 0) {
    /*
     * Record zero-value event without crediting wallet.
     */
    await sql`
      INSERT INTO cpx_transactions (
        transaction_id,
        user_id,
        status,
        type,
        amount_local,
        amount_usd,
        coins
      )
      VALUES (
        ${transId},
        ${userId},
        1,
        ${type},
        ${amountLocal},
        ${amountUsd},
        0
      )
      ON CONFLICT (transaction_id)
      DO NOTHING
    `;

    return send(res, 200, {
      success: true,
      message: 'CPX event recorded with no reward',
      coins: 0
    });
  }

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

  /*
   * Record transaction first.
   * Unique transaction_id protects against duplicate callbacks.
   */
  const inserted = await sql`
    INSERT INTO cpx_transactions (
      transaction_id,
      user_id,
      status,
      type,
      amount_local,
      amount_usd,
      coins
    )
    VALUES (
      ${transId},
      ${userId},
      1,
      ${type},
      ${amountLocal},
      ${amountUsd},
      ${coins}
    )
    ON CONFLICT (transaction_id)
    DO NOTHING
    RETURNING id
  `;

  if (!inserted.length) {
    return send(res, 200, {
      success: true,
      message: 'CPX transaction already processed'
    });
  }

  /*
   * Add CPX reward to EarnNest wallet.
   */
  const wallet = await sql`
    UPDATE wallets
    SET
      balance = COALESCE(balance, 0) + ${coins},
      total_earned = COALESCE(total_earned, 0) + ${coins}
    WHERE user_id = ${userId}
    RETURNING
      balance,
      total_earned,
      total_withdrawn
  `;

  if (!wallet.length) {

    await sql`
      DELETE FROM cpx_transactions
      WHERE transaction_id = ${transId}
    `;

    return send(res, 500, {
      success: false,
      message: 'Wallet could not be updated'
    });
  }

  return send(res, 200, {
    success: true,
    message: 'CPX reward credited successfully',
    transactionId: transId,
    coins,
    amountUsd,
    wallet: {
      balance: Number(wallet[0].balance || 0),
      totalEarned: Number(wallet[0].total_earned || 0),
      totalWithdrawn: Number(wallet[0].total_withdrawn || 0)
    }
  });
}

/*
 * Generate a CPX SurveyWall URL for the logged-in EarnNest user.
 * The CPX secure hash never comes from the browser.
 */
async function handleCPXLink(req, res) {

  const token = getToken(req);

  if (!token) {
    return send(res, 401, {
      success: false,
      message: 'Authentication required'
    });
  }

  if (!CPX_SECURE_HASH) {
    return send(res, 500, {
      success: false,
      message: 'CPX configuration missing'
    });
  }

  const rows = await sql`
    SELECT
      u.id,
      u.name,
      u.username,
      u.email
    FROM admin_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token}
      AND s.expires_at > NOW()
    LIMIT 1
  `;

  if (!rows.length) {
    return send(res, 401, {
      success: false,
      message: 'Invalid or expired session'
    });
  }

  const user = rows[0];
  const userId = String(user.id);

  const secureHash = md5(
    `${userId}-${CPX_SECURE_HASH}`
  );

  const params = new URLSearchParams({
    app_id: CPX_APP_ID,
    ext_user_id: userId,
    secure_hash: secureHash,
    username: String(user.username || user.name || ''),
    email: String(user.email || ''),
    subid_1: '',
    subid_2: ''
  });

  const url =
    `https://offers.cpx-research.com/index.php?${params.toString()}`;

  return send(res, 200, {
    success: true,
    appId: CPX_APP_ID,
    url
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

async function handleLocalSurvey(req, res) {

  const token = getToken(req);

  if (!token) {
    return send(res, 401, {
      success: false,
      message: 'Authentication required'
    });
  }

  const body = await readBody(req);

  if (body.action === 'cpx-link') {
    return handleCPXLink(req, res);
  }

  const surveyId = String(
    body.surveyId || ''
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
      message: 'Invalid survey'
    });
  }

  const sessions = await sql`
    SELECT user_id
    FROM admin_sessions
    WHERE token = ${token}
      AND expires_at > NOW()
    LIMIT 1
  `;

  if (!sessions.length) {
    return send(res, 401, {
      success: false,
      message: 'Invalid or expired session'
    });
  }

  const userId = String(
    sessions[0].user_id
  );

  await sql`
    CREATE TABLE IF NOT EXISTS survey_claims (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      survey_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      reward INTEGER NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, survey_id, period_key)
    )
  `;

  const periodKey =
    'day:' + new Date().toISOString().slice(0, 10);

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
    ON CONFLICT (user_id, survey_id, period_key)
    DO NOTHING
    RETURNING id
  `;

  if (!claim.length) {
    return send(res, 409, {
      success: false,
      message: 'Survey already completed today'
    });
  }

  const walletResult = await sql`
    UPDATE wallets
    SET
      balance = COALESCE(balance, 0) + ${survey.reward},
      total_earned = COALESCE(total_earned, 0) + ${survey.reward}
    WHERE user_id = ${userId}
    RETURNING
      balance,
      total_earned,
      total_withdrawn
  `;

  if (!walletResult.length) {

    await sql`
      DELETE FROM survey_claims
      WHERE id = ${claim[0].id}
    `;

    return send(res, 500, {
      success: false,
      message: 'Wallet could not be updated'
    });
  }

  const wallet = walletResult[0];

  return send(res, 200, {
    success: true,
    message: `${survey.title} completed successfully`,
    survey: {
      id: surveyId,
      title: survey.title,
      reward: survey.reward
    },
    wallet: {
      balance: Number(wallet.balance || 0),
      totalEarned: Number(wallet.total_earned || 0),
      totalWithdrawn: Number(wallet.total_withdrawn || 0)
    }
  });
}

module.exports = async function handler(req, res) {

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

  /*
   * CPX calls the URL with GET query parameters.
   */
  const query = req.query || {};

  if (
    req.method === 'GET' &&
    query.status &&
    query.trans_id &&
    query.user_id
  ) {
    try {
      return await handleCPXPostback(req, res);
    } catch (error) {
      console.error(
        'CPX postback error:',
        error
      );

      return send(res, 500, {
        success: false,
        message: 'CPX server error'
      });
    }
  }

  if (req.method !== 'POST') {
    return send(res, 405, {
      success: false,
      message: 'Method not allowed'
    });
  }

  try {
    return await handleLocalSurvey(req, res);
  } catch (error) {
    console.error(
      'Survey API error:',
      error
    );

    return send(res, 500, {
      success: false,
      message: error.message || 'Server error'
    });
  }
};
