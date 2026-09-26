'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

function send(res, status, message) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify({
    success: status >= 200 && status < 300,
    message
  }));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return send(res, 405, 'GET method required');
  }

  try {
    const key = process.env.ADGEM_POSTBACK_KEY;

    if (!key) {
      console.error('ADGEM_POSTBACK_KEY is missing');
      return send(res, 500, 'Postback key is not configured');
    }

    const verifier = req.query?.verifier;

    if (!verifier) {
      return send(res, 422, 'Missing verifier');
    }

    // Build the URL exactly as received, but remove verifier.
    const protocol =
      req.headers['x-forwarded-proto'] ||
      (req.connection?.encrypted ? 'https' : 'http');

    const host = req.headers.host;
    const originalUrl = req.url || '/';

    const url = new URL(`${protocol}://${host}${originalUrl}`);

    url.searchParams.delete('verifier');

    const hashlessUrl = url.toString();

    const calculated = crypto
      .createHmac('sha256', key)
      .update(hashlessUrl)
      .digest('hex');

    const receivedBuffer = Buffer.from(String(verifier), 'utf8');
    const calculatedBuffer = Buffer.from(calculated, 'utf8');

    if (
      receivedBuffer.length !== calculatedBuffer.length ||
      !crypto.timingSafeEqual(receivedBuffer, calculatedBuffer)
    ) {
      console.error('Invalid AdGem verifier');
      return send(res, 422, 'Invalid verifier');
    }

    const playerId = req.query?.player_id;
    const amount = Number(req.query?.amount || 0);
    const transactionId =
      req.query?.transaction_id ||
      req.query?.request_id ||
      '';

    if (!playerId) {
      return send(res, 422, 'Missing player_id');
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return send(res, 422, 'Invalid reward amount');
    }

    if (!transactionId) {
      return send(res, 422, 'Missing transaction_id');
    }

    // Find EarnNest user.
    const users = await sql`
      SELECT id
      FROM users
      WHERE id = ${String(playerId)}
      LIMIT 1
    `;

    if (!users.length) {
      return send(res, 404, 'Player not found');
    }

    const userId = users[0].id;

    // Prevent duplicate rewards.
    const existing = await sql`
      SELECT id
      FROM adgem_conversions
      WHERE transaction_id = ${String(transactionId)}
      LIMIT 1
    `;

    if (existing.length) {
      return send(res, 200, 'Conversion already processed');
    }

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
      ON CONFLICT (user_id) DO NOTHING
    `;

    // Credit reward.
    await sql`
      UPDATE wallets
      SET
        balance = COALESCE(balance, 0) + ${amount},
        total_earned = COALESCE(total_earned, 0) + ${amount}
      WHERE user_id = ${userId}
    `;

    // Record conversion.
    await sql`
      INSERT INTO adgem_conversions (
        user_id,
        transaction_id,
        player_id,
        amount,
        offer_id,
        offer_name,
        goal_id,
        goal_name,
        country,
        payout,
        conversion_datetime
      )
      VALUES (
        ${userId},
        ${String(transactionId)},
        ${String(playerId)},
        ${amount},
        ${String(req.query?.offer_id || '')},
        ${String(req.query?.offer_name || '')},
        ${String(req.query?.goal_id || '')},
        ${String(req.query?.goal_name || '')},
        ${String(req.query?.country || '')},
        ${Number(req.query?.payout || 0)},
        ${String(req.query?.conversion_datetime || '')}
      )
    `;

    return send(res, 200, 'Reward credited successfully');

  } catch (error) {
    console.error('AdGem postback error:', error);
    return send(res, 500, 'Server error');
  }
};
