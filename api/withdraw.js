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

module.exports = async function handler(req, res) {

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

    const amount = Number(body.amount || 0);
    const paymentMethod = String(
      body.paymentMethod || ''
    ).trim();
    const accountNumber = String(
      body.accountNumber || body.account || ''
    ).trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return send(res, 400, {
        success: false,
        message: 'Valid withdrawal amount is required'
      });
    }

    if (!paymentMethod) {
      return send(res, 400, {
        success: false,
        message: 'Payment method is required'
      });
    }

    if (!accountNumber) {
      return send(res, 400, {
        success: false,
        message: 'Account / Number is required'
      });
    }

    const allowedMethods = [
      'Easypaisa',
      'JazzCash',
      'Bank Transfer'
    ];

    if (!allowedMethods.includes(paymentMethod)) {
      return send(res, 400, {
        success: false,
        message: 'Invalid payment method'
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
      CREATE TABLE IF NOT EXISTS withdrawals (
        id BIGSERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        payment_method TEXT NOT NULL,
        account_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    const walletResult = await sql`
      SELECT
        balance,
        total_earned,
        total_withdrawn
      FROM wallets
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    if (!walletResult.length) {
      return send(res, 400, {
        success: false,
        message: 'Wallet not found'
      });
    }

    const balance = Number(
      walletResult[0].balance || 0
    );

    if (amount > balance) {
      return send(res, 400, {
        success: false,
        message: 'Insufficient balance'
      });
    }

    const withdrawal = await sql`
      INSERT INTO withdrawals (
        user_id,
        amount,
        payment_method,
        account_number,
        status
      )
      VALUES (
        ${userId},
        ${Math.floor(amount)},
        ${paymentMethod},
        ${accountNumber},
        'pending'
      )
      RETURNING
        id,
        amount,
        payment_method,
        status,
        created_at
    `;

    await sql`
      UPDATE wallets
      SET
        balance = COALESCE(balance, 0) - ${Math.floor(amount)},
        total_withdrawn =
          COALESCE(total_withdrawn, 0) + ${Math.floor(amount)}
      WHERE user_id = ${userId}
    `;

    return send(res, 200, {
      success: true,
      message: 'Withdrawal request submitted successfully',
      withdrawal: {
        id: String(withdrawal[0].id),
        amount: Number(withdrawal[0].amount),
        paymentMethod: withdrawal[0].payment_method,
        status: withdrawal[0].status,
        createdAt: withdrawal[0].created_at
      }
    });

  } catch (error) {

    console.error(
      'Withdrawal API error:',
      error
    );

    return send(res, 500, {
      success: false,
      message: error.message || 'Server error'
    });
  }
};
