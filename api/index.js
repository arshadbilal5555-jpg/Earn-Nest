```js
/* =========================================================
   ADGEM POSTBACK
   Server-to-server reward callback
========================================================= */

async function handleAdGemPostback(req, res) {
  if (req.method !== 'GET') {
    return send(res, 405, {
      success: false,
      message: 'Method not allowed'
    });
  }

  try {
    const postbackKey =
      process.env.ADGEM_POSTBACK_KEY;

    if (!postbackKey) {
      console.error(
        'ADGEM ERROR: ADGEM_POSTBACK_KEY is missing'
      );

      return send(res, 500, {
        success: false,
        message: 'AdGem configuration error'
      });
    }

    const rawUrl = req.url || '';

    const queryIndex = rawUrl.indexOf('?');

    const rawQuery =
      queryIndex >= 0
        ? rawUrl.substring(queryIndex + 1)
        : '';

    const params = new URLSearchParams(rawQuery);

    const verifier =
      String(params.get('verifier') || '').trim();

    const playerId =
      String(params.get('player_id') || '').trim();

    const transactionId =
      String(params.get('transaction_id') || '').trim();

    const amountRaw =
      String(params.get('amount') || '').trim();

    const payout =
      String(params.get('payout') || '').trim();

    const offerId =
      String(params.get('offer_id') || '').trim();

    const offerName =
      String(params.get('offer_name') || '').trim();

    const goalId =
      String(params.get('goal_id') || '').trim();

    const goalName =
      String(params.get('goal_name') || '').trim();

    const country =
      String(params.get('country') || '').trim();

    const appId =
      String(params.get('app_id') || '').trim();

    /* -------------------------
       REQUIRED DATA
    ------------------------- */

    if (!verifier) {
      return send(res, 400, {
        success: false,
        message: 'Missing verifier'
      });
    }

    if (!playerId) {
      return send(res, 400, {
        success: false,
        message: 'Missing player_id'
      });
    }

    if (!transactionId) {
      return send(res, 400, {
        success: false,
        message: 'Missing transaction_id'
      });
    }

    const amount = Number(amountRaw);

    /*
      IMPORTANT:
      AdGem "amount" is EarnNest virtual currency.
      "payout" is USD and must NOT be credited as coins.
    */

    if (
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      return send(res, 400, {
        success: false,
        message: 'Invalid reward amount'
      });
    }

    /* -------------------------
       APP ID SECURITY
    ------------------------- */

    const EXPECTED_ADGEM_APP_ID = '33775';

    if (
      appId &&
      appId !== EXPECTED_ADGEM_APP_ID
    ) {
      return send(res, 403, {
        success: false,
        message: 'Invalid AdGem app_id'
      });
    }

    /* -------------------------
       CREATE SIGNED URL
       WITHOUT verifier
    ------------------------- */

    const queryWithoutVerifier =
      rawQuery
        .split('&')
        .filter(part => {
          const equalIndex =
            part.indexOf('=');

          const key =
            equalIndex >= 0
              ? part.substring(
                  0,
                  equalIndex
                )
              : part;

          try {
            return (
              decodeURIComponent(key)
                .toLowerCase() !==
              'verifier'
            );
          } catch {
            return (
              key.toLowerCase() !==
              'verifier'
            );
          }
        })
        .join('&');

    const forwardedProto =
      String(
        req.headers['x-forwarded-proto'] ||
        'https'
      )
        .split(',')[0]
        .trim();

    const host =
      String(
        req.headers.host ||
        'earn-nest-gamma.vercel.app'
      ).trim();

    const pathOnly =
      queryIndex >= 0
        ? rawUrl.substring(
            0,
            queryIndex
          )
        : rawUrl;

    const signedUrl =
      `${forwardedProto}://${host}` +
      `${pathOnly}` +
      `${
        queryWithoutVerifier
          ? `?${queryWithoutVerifier}`
          : ''
      }`;

    /* -------------------------
       VERIFY HMAC
    ------------------------- */

    const calculatedVerifier =
      crypto
        .createHmac(
          'sha256',
          postbackKey
        )
        .update(
          signedUrl,
          'utf8'
        )
        .digest('hex');

    const receivedBuffer =
      Buffer.from(
        verifier.toLowerCase(),
        'utf8'
      );

    const calculatedBuffer =
      Buffer.from(
        calculatedVerifier.toLowerCase(),
        'utf8'
      );

    if (
      receivedBuffer.length !==
      calculatedBuffer.length
    ) {
      return send(res, 403, {
        success: false,
        message: 'Invalid AdGem signature'
      });
    }

    if (
      !crypto.timingSafeEqual(
        receivedBuffer,
        calculatedBuffer
      )
    ) {
      return send(res, 403, {
        success: false,
        message: 'Invalid AdGem signature'
      });
    }

    /* -------------------------
       TRANSACTION
    ------------------------- */

    let client;

    try {
      client = await pool.connect();

      await client.query('BEGIN');

      /* -------------------------
         FIND + LOCK USER
      ------------------------- */

      const userResult =
        await client.query(
          `
          SELECT
            id,
            coins,
            status
          FROM users
          WHERE id = $1
          FOR UPDATE
          `,
          [playerId]
        );

      if (!userResult.rows.length) {
        await client.query(
          'ROLLBACK'
        );

        return send(res, 404, {
          success: false,
          message: 'Player not found'
        });
      }

      const user =
        userResult.rows[0];

      if (
        user.status !== 'active'
      ) {
        await client.query(
          'ROLLBACK'
        );

        return send(res, 403, {
          success: false,
          message: 'Player is not active'
        });
      }

      /* -------------------------
         DUPLICATE PROTECTION
      ------------------------- */

      const existingClaim =
        await client.query(
          `
          SELECT
            id,
            amount
          FROM reward_claims
          WHERE user_id = $1
            AND reward_type = 'adgem'
            AND reference_key = $2
          LIMIT 1
          `,
          [
            playerId,
            transactionId
          ]
        );

      if (
        existingClaim.rows.length
      ) {
        await client.query(
          'COMMIT'
        );

        return send(res, 200, {
          success: true,
          duplicate: true,
          message:
            'AdGem reward already processed'
        });
      }

      /* -------------------------
         UPDATE USERS.COINS
      ------------------------- */

      const updatedUser =
        await client.query(
          `
          UPDATE users
          SET
            coins =
              COALESCE(coins, 0)
              + $1
          WHERE id = $2
          RETURNING
            id,
            coins
          `,
          [
            amount,
            playerId
          ]
        );

      if (
        !updatedUser.rows.length
      ) {
        await client.query(
          'ROLLBACK'
        );

        return send(res, 500, {
          success: false,
          message:
            'User balance update failed'
        });
      }

      /* -------------------------
         UPDATE WALLET
      ------------------------- */

      const walletResult =
        await client.query(
          `
          SELECT
            id,
            balance,
            total_earned,
            total_withdrawn
          FROM wallets
          WHERE user_id = $1
          FOR UPDATE
          `,
          [playerId]
        );

      if (
        !walletResult.rows.length
      ) {
        await client.query(
```
