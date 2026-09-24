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

    const userId = String(sessionRows[0].user_id);

    await sql`
      CREATE TABLE IF NOT EXISTS daily_bonus_claims (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        claim_date DATE NOT NULL,
        reward INTEGER NOT NULL,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, claim_date)
      )
    `;

    const today = new Date()
      .toISOString()
      .slice(0, 10);

    const existing = await sql`
      SELECT id
      FROM daily_bonus_claims
      WHERE user_id = ${userId}
        AND claim_date = ${today}
      LIMIT 1
    `;

    if (existing.length) {
      return send(res, 409, {
        success: false,
        message: 'Daily bonus already claimed today'
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

    const reward = 50;

    await sql`
      INSERT INTO daily_bonus_claims (
        user_id,
        claim_date,
        reward
      )
      VALUES (
        ${userId},
        ${today},
        ${reward}
      )
    `;

    const walletResult = await sql`
      UPDATE wallets
      SET
        balance = COALESCE(balance, 0) + ${reward},
        total_earned = COALESCE(total_earned, 0) + ${reward}
      WHERE user_id = ${userId}
      RETURNING
        balance,
        total_earned,
        total_withdrawn
    `;

    if (!walletResult.length) {
      await sql`
        DELETE FROM daily_bonus_claims
        WHERE user_id = ${userId}
          AND claim_date = ${today}
      `;

      return send(res, 500, {
        success: false,
        message: 'Wallet not found'
      });
    }

    const wallet = walletResult[0];

    return send(res, 200, {
      success: true,
      message: 'Daily bonus credited successfully',
      reward,
      wallet: {
        balance: Number(wallet.balance || 0),
        totalEarned: Number(wallet.total_earned || 0),
        totalWithdrawn: Number(wallet.total_withdrawn || 0)
      }
    });

  } catch (error) {

    console.error(
      'Daily bonus API error:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Server error'
    });
  }
};
