'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

function safeEqual(a, b) {
  if (!a || !b) return false;

  const aa = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');

  return (
    aa.length === bb.length &&
    crypto.timingSafeEqual(aa, bb)
  );
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;

      if (body.length > 1024 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS adgem_conversions (
      id BIGSERIAL PRIMARY KEY,
      request_id TEXT UNIQUE NOT NULL,
      conversion_id TEXT UNIQUE,
      player_id TEXT NOT NULL,
      offer_id TEXT,
      goal_id TEXT,
      offer_name TEXT,
      goal_name TEXT,
      amount INTEGER NOT NULL DEFAULT 0,
      payout NUMERIC(12,4) DEFAULT 0,
      country TEXT,
      platform TEXT,
      conversion_type TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      credited_at TIMESTAMPTZ
    )
  `;
}

async function creditConversion(data, requestId) {
  const playerId = String(data.player_id || '').trim();

  if (!playerId) {
    return {
      ok: false,
      status: 400,
      message: 'Missing player_id'
    };
  }

  const amount = Number(data.amount || 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      ok: false,
      status: 400,
      message: 'Invalid reward amount'
    };
  }

  const conversionId = String(
    data.conversion_id || ''
  ).trim() || null;

  const offerId = String(
    data.offer_id || ''
  ).trim() || null;

  const goalId = String(
    data.goal_id || ''
  ).trim() || null;

  const offerName = String(
    data.offer_name || ''
  ).trim() || null;

  const goalName = String(
    data.goal_name || ''
  ).trim() || null;

  const payout = Number(data.payout || 0);

  const country = String(
    data.country || ''
  ).trim() || null;

  const platform = String(
    data.platform || ''
  ).trim() || null;

  const conversionType = String(
    data.conversion_type || 'reward'
  ).trim();

  // Only reward conversions should add coins.
  if (conversionType !== 'reward') {
    return {
      ok: true,
      status: 200,
      message: 'Non-reward conversion ignored'
    };
  }

  await ensureTable();

  // Find user.
  const users = await sql`
    SELECT id
    FROM users
    WHERE id::TEXT = ${playerId}
    LIMIT 1
  `;

  if (!users.length) {
    return {
      ok: false,
      status: 404,
      message: 'EarnNest user not found'
    };
  }

  const userId = String(users[0].id);

  // Make sure wallet exists.
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

  // Check duplicate request/conversion.
  const existing = await sql`
    SELECT
      id,
      status
    FROM adgem_conversions
    WHERE request_id = ${requestId}
       OR (
         conversion_id IS NOT NULL
         AND conversion_id = ${conversionId}
       )
    LIMIT 1
  `;

  if (existing.length) {
    return {
      ok: true,
      status: 200,
      duplicate: true,
      message: 'Conversion already processed'
    };
  }

  // Record conversion before crediting.
  await sql`
    INSERT INTO adgem_conversions (
      request_id,
      conversion_id,
      player_id,
      offer_id,
      goal_id,
      offer_name,
      goal_name,
      amount,
      payout,
      country,
      platform,
      conversion_type,
      status
    )
    VALUES (
      ${requestId},
      ${conversionId},
      ${userId},
      ${offerId},
      ${goalId},
      ${offerName},
      ${goalName},
      ${amount},
      ${Number.isFinite(payout) ? payout : 0},
      ${country},
      ${platform},
      ${conversionType},
      'pending'
    )
  `;

  // Credit wallet.
  const wallet = await sql`
    UPDATE wallets
    SET
      balance = COALESCE(balance, 0) + ${amount},
      total_earned = COALESCE(total_earned, 0) + ${amount}
    WHERE user_id = ${userId}
    RETURNING
      balance,
      total_earned,
      total_withdrawn
  `;

  if (!wallet.length) {
    await sql`
      DELETE FROM adgem_conversions
      WHERE request_id = ${requestId}
    `;

    return {
      ok: false,
      status: 500,
      message: 'Wallet update failed'
    };
  }

  // Mark conversion as credited.
  await sql`
    UPDATE adgem_conversions
    SET
      status = 'credited',
      credited_at = NOW()
    WHERE request_id = ${requestId}
  `;

  return {
    ok: true,
    status: 200,
    message: 'AdGem reward credited successfully',
    userId,
    coins: amount,
    balance: Number(wallet[0].balance || 0)
  };
}

module.exports = async (req, res) => {
  try {
    /*
     * ----------------------------------------------------
     * ADGEM V3 - POST
     * Recommended by AdGem.
     * Signature = HMAC-SHA256(raw JSON body, Postback Key)
     * ----------------------------------------------------
     */

    if (req.method === 'POST') {
      const rawBody = await readRawBody(req);

      if (!rawBody) {
        return send(res, 400, {
          success: false,
          message: 'Empty request body'
        });
      }

      const signature =
        req.headers.signature ||
        req.headers.Signature ||
        '';

      const postbackKey =
        process.env.ADGEM_POSTBACK_KEY || '';

      if (!postbackKey) {
        console.error('ADGEM_POSTBACK_KEY is missing');

        return send(res, 500, {
          success: false,
          message: 'AdGem configuration missing'
        });
      }

      const expectedSignature = crypto
        .createHmac('sha256', postbackKey)
        .update(rawBody)
        .digest('hex');

      if (!safeEqual(expectedSignature, signature)) {
        return send(res, 401, {
          success: false,
          message: 'Invalid AdGem signature'
        });
      }

      let body;

      try {
        body = JSON.parse(rawBody);
      } catch {
        return send(res, 400, {
          success: false,
          message: 'Invalid JSON'
        });
      }

      const requestId = String(
        body.request_id || ''
      ).trim();

      if (!requestId) {
        return send(res, 400, {
          success: false,
          message: 'Missing request_id'
        });
      }

      const data = body.data || {};

      const result = await creditConversion(
        data,
        requestId
      );

      return send(res, result.status, {
        success: result.ok,
        ...result
      });
    }

    /*
     * ----------------------------------------------------
     * ADGEM V2 - GET
     * Kept as compatibility support for the dashboard
     * configuration you are currently seeing.
     * ----------------------------------------------------
     */

    if (req.method === 'GET') {
      const postbackKey =
        process.env.ADGEM_POSTBACK_KEY || '';

      if (!postbackKey) {
        return send(res, 500, {
          success: false,
          message: 'AdGem configuration missing'
        });
      }

      const requestUrl =
        `https://${req.headers.host}${req.url}`;

      const url = new URL(requestUrl);

      const verifier =
        url.searchParams.get('verifier');

      if (!verifier) {
        return send(res, 401, {
          success: false,
          message: 'Missing verifier'
        });
      }

      // Remove verifier before calculating HMAC.
      url.searchParams.delete('verifier');

      const hashlessUrl = url.toString();

      const expectedVerifier = crypto
        .createHmac('sha256', postbackKey)
        .update(hashlessUrl)
        .digest('hex');

      if (!safeEqual(expectedVerifier, verifier)) {
        return send(res, 401, {
          success: false,
          message: 'Invalid AdGem verifier'
        });
      }

      const params = Object.fromEntries(
        url.searchParams.entries()
      );

      const requestId = String(
        params.request_id || ''
      ).trim();

      if (!requestId) {
        return send(res, 400, {
          success: false,
          message: 'Missing request_id'
        });
      }

      const result = await creditConversion(
        params,
        requestId
      );

      return send(res, result.status, {
        success: result.ok,
        ...result
      });
    }

    return send(res, 405, {
      success: false,
      message: 'Method not allowed'
    });

  } catch (error) {
    console.error(
      'AdGem postback error:',
      error
    );

    return send(res, 500, {
      success: false,
      message: 'Server error'
    });
  }
};
