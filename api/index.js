'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

/* =========================================================
   REWARD CATALOG
========================================================= */

const TASK_REWARDS = {
  task1: 50,
  task2: 100,
  task3: 75,
  task4: 100,
  task5: 150,
  task6: 50,
  task7: 50,
  task8: 75
};

const SURVEY_REWARDS = {
  survey1: 150,
  survey2: 200,
  survey3: 250,
  survey4: 300,
  survey5: 250
};

const DAILY_BONUS_AMOUNT = 50;

/* Referral */
const REFERRER_REWARD = 100;
const NEW_USER_REFERRAL_BONUS = 50;

/* Withdrawal */
const MIN_WITHDRAWAL = 1000;


/* =========================================================
   BASIC HELPERS
========================================================= */

function send(res, status, data) {
  res.statusCode = status;

  res.setHeader(
    'Content-Type',
    'application/json'
  );

  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  return res.end(JSON.stringify(data));
}


function getToken(req) {
  const auth =
    req.headers.authorization || '';

  if (auth.startsWith('Bearer ')) {
    return auth.substring(7).trim();
  }

  return '';
}


async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(
          new Error('Invalid JSON body.')
        );
      }
    });

    req.on('error', reject);
  });
}


function makeId() {
  return crypto.randomUUID();
}


function makeToken() {
  return crypto
    .randomBytes(48)
    .toString('hex');
}


function makeReferralCode() {
  return crypto
    .randomBytes(5)
    .toString('hex')
    .toUpperCase();
}


/* =========================================================
   WALLET RESPONSE
========================================================= */

function walletResponse(wallet) {
  const balance =
    Number(wallet?.balance || 0);

  const totalEarned =
    Number(wallet?.total_earned || 0);

  const totalWithdrawn =
    Number(wallet?.total_withdrawn || 0);

  return {
    balance,

    total_earned:
      totalEarned,

    total_withdrawn:
      totalWithdrawn,

    totalEarned,

    totalWithdrawn
  };
}


/* =========================================================
   GET USER FROM TOKEN
========================================================= */

async function getUserFromToken(req) {
  const token =
    getToken(req);

  if (!token) {
    return null;
  }

  const rows = await sql`
    SELECT
      u.id,
      u.name,
      u.username,
      u.email,
      u.phone,
      u.role,
      u.coins,
      u.created_at,
      u.referral_code,
      u.referred_by

    FROM admin_sessions s

    JOIN users u
      ON u.id = s.user_id

    WHERE s.token = ${token}
      AND s.expires_at > NOW()

    LIMIT 1
  `;

  return rows[0] || null;
}


/* =========================================================
   GET WALLET
========================================================= */

async function getWallet(userId) {
  const uid =
    String(userId);

  const rows = await sql`
    SELECT
      id,
      user_id,
      balance,
      total_earned,
      total_withdrawn,
      created_at,
      updated_at

    FROM wallets

    WHERE user_id = ${uid}

    LIMIT 1
  `;

  if (rows.length) {
    return rows[0];
  }

  const created = await sql`
    INSERT INTO wallets
      (
        user_id,
        balance,
        total_earned,
        total_withdrawn,
        created_at,
        updated_at
      )

    VALUES
      (
        ${uid},
        0,
        0,
        0,
        NOW(),
        NOW()
      )

    RETURNING
      id,
      user_id,
      balance,
      total_earned,
      total_withdrawn,
      created_at,
      updated_at
  `;

  return created[0];
}


/* =========================================================
   ADD COINS
========================================================= */

async function addCoins(userId, amount) {
  const uid =
    String(userId);

  const value =
    Number(amount);

  const wallet =
    await getWallet(uid);

  const oldBalance =
    Number(wallet.balance || 0);

  const oldEarned =
    Number(wallet.total_earned || 0);

  const totalWithdrawn =
    Number(
      wallet.total_withdrawn || 0
    );

  const newBalance =
    oldBalance + value;

  const newEarned =
    oldEarned + value;

  await sql`
    UPDATE wallets

    SET
      balance = ${newBalance},
      total_earned = ${newEarned},
      updated_at = NOW()

    WHERE user_id = ${uid}
  `;

  await sql`
    UPDATE users

    SET coins = ${newBalance}

    WHERE id = ${uid}
  `;

  return {
    balance: newBalance,
    total_earned: newEarned,
    total_withdrawn: totalWithdrawn
  };
}


/* =========================================================
   LOGIN
========================================================= */

async function handleLogin(body, res) {
  const email =
    String(body.email || '')
      .trim()
      .toLowerCase();

  const login =
    String(body.login || '')
      .trim()
      .toLowerCase();

  const username =
    String(body.username || '')
      .trim()
      .toLowerCase();

  const password =
    String(body.password || '');

  const identifier =
    email ||
    login ||
    username;

  if (!identifier || !password) {
    return send(res, 400, {
      success: false,
      message:
        'Email/username and password are required.'
    });
  }

  try {
    const users = await sql`
      SELECT
        id,
        name,
        username,
        email,
        phone,
        password,
        role,
        coins,
        created_at,
        referral_code,
        referred_by

      FROM users

      WHERE LOWER(email) = ${identifier}
         OR LOWER(username) = ${identifier}

      LIMIT 1
    `;

    if (!users.length) {
      return send(res, 401, {
        success: false,
        message:
          'Invalid email/username or password.'
      });
    }

    const dbUser =
      users[0];

    if (
      String(dbUser.password || '') !==
      password
    ) {
      return send(res, 401, {
        success: false,
        message:
          'Invalid email/username or password.'
      });
    }

    const token =
      makeToken();

    await sql`
      INSERT INTO admin_sessions
        (
          user_id,
          token,
          expires_at,
          created_at
        )

      VALUES
        (
          ${String(dbUser.id)},
          ${token},
          NOW() + INTERVAL '30 days',
          NOW()
        )
    `;

    const wallet =
      await getWallet(
        String(dbUser.id)
      );

    const walletData =
      walletResponse(wallet);

    const safeUser = {
      id: dbUser.id,
      name: dbUser.name,
      username: dbUser.username,
      email: dbUser.email,
      phone: dbUser.phone,
      role: dbUser.role,

      coins:
        walletData.balance,

      balance:
        walletData.balance,

      totalEarned:
        walletData.totalEarned,

      totalWithdrawn:
        walletData.totalWithdrawn,

      created_at:
        dbUser.created_at,

      referral_code:
        dbUser.referral_code,

      referralCode:
        dbUser.referral_code,

      referred_by:
        dbUser.referred_by
    };

    return send(res, 200, {
      success: true,
      message:
        'Login successful.',
      token,
      user: safeUser,
      wallet: walletData
    });

  } catch (error) {
    console.error(
      'LOGIN ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Login database error.',
      error:
        error.message ||
        'Unknown database error',
      code:
        error.code || null,
      detail:
        error.detail || null
    });
  }
}


/* =========================================================
   REGISTER + REFERRAL
========================================================= */

async function handleRegister(body, res) {
  const name =
    String(body.name || '')
      .trim();

  const username =
    String(body.username || '')
      .trim();

  const email =
    String(body.email || '')
      .trim()
      .toLowerCase();

  const phone =
    String(body.phone || '')
      .trim();

  const password =
    String(body.password || '');

  const confirmPassword =
    String(
      body.confirmPassword ||
      body.confirm_password ||
      ''
    );

  const referralCode =
    String(
      body.referralCode ||
      body.referral_code ||
      ''
    )
      .trim()
      .toUpperCase();

  if (
    !name ||
    !username ||
    !email ||
    !password
  ) {
    return send(res, 400, {
      success: false,
      message:
        'Name, username, email and password are required.'
    });
  }

  if (password.length < 6) {
    return send(res, 400, {
      success: false,
      message:
        'Password must be at least 6 characters.'
    });
  }

  if (
    confirmPassword &&
    password !== confirmPassword
  ) {
    return send(res, 400, {
      success: false,
      message:
        'Passwords do not match.'
    });
  }

  try {

    const existing =
      await sql`
        SELECT
          id,
          email,
          username

        FROM users

        WHERE LOWER(email) = ${email}
           OR LOWER(username) =
              ${username.toLowerCase()}

        LIMIT 1
      `;

    if (existing.length) {

      if (
        String(existing[0].email || '')
          .toLowerCase() === email
      ) {
        return send(res, 409, {
          success: false,
          message:
            'Email already registered.'
        });
      }

      return send(res, 409, {
        success: false,
        message:
          'Username already taken.'
      });
    }


    /* ---------------------------------------------
       FIND REFERRER
    --------------------------------------------- */

    let referrer = null;
    let referredBy = null;

    if (referralCode) {

      const referrerRows =
        await sql`
          SELECT
            id,
            name,
            username,
            referral_code

          FROM users

          WHERE UPPER(referral_code) =
                ${referralCode}

          LIMIT 1
        `;

      if (!referrerRows.length) {
        return send(res, 400, {
          success: false,
          message:
            'Invalid referral code.'
        });
      }

      referrer =
        referrerRows[0];

      referredBy =
        String(referrer.id);
    }


    /* ---------------------------------------------
       UNIQUE REFERRAL CODE
    --------------------------------------------- */

    let newReferralCode =
      makeReferralCode();

    for (let i = 0; i < 10; i++) {

      const codeCheck =
        await sql`
          SELECT id
          FROM users
          WHERE UPPER(referral_code) =
                ${newReferralCode}
          LIMIT 1
        `;

      if (!codeCheck.length) {
        break;
      }

      newReferralCode =
        makeReferralCode();
    }


    /* ---------------------------------------------
       CREATE USER
    --------------------------------------------- */

    const userId =
      makeId();

    const created =
      await sql`
        INSERT INTO users
          (
            id,
            name,
            username,
            email,
            phone,
            password,
            role,
            coins,
            created_at,
            referral_code,
            referred_by
          )

        VALUES
          (
            ${userId},
            ${name},
            ${username},
            ${email},
            ${phone},
            ${password},
            'user',
            0,
            NOW(),
            ${newReferralCode},
            ${referredBy}
          )

        RETURNING
          id,
          name,
          username,
          email,
          phone,
          role,
          coins,
          created_at,
          referral_code,
          referred_by
      `;


    /* ---------------------------------------------
       CREATE WALLET
    --------------------------------------------- */

    await sql`
      INSERT INTO wallets
        (
          user_id,
          balance,
          total_earned,
          total_withdrawn,
          created_at,
          updated_at
        )

      VALUES
        (
          ${userId},
          0,
          0,
          0,
          NOW(),
          NOW()
        )
    `;


    /* ---------------------------------------------
       REFERRAL REWARDS
    --------------------------------------------- */

    if (referrer) {

      const referrerClaimKey =
        `referral_referrer_${userId}`;

      const referrerAlready =
        await sql`
          SELECT id

          FROM reward_claims

          WHERE reward_type = 'referral'
            AND reference_key =
                ${referrerClaimKey}

          LIMIT 1
        `;

      if (!referrerAlready.length) {

        await addCoins(
          String(referrer.id),
          REFERRER_REWARD
        );

        await sql`
          INSERT INTO reward_claims
            (
              id,
              user_id,
              reward_type,
              reference_key,
              title,
              amount,
              created_at
            )

          VALUES
            (
              ${makeId()},
              ${String(referrer.id)},
              'referral',
              ${referrerClaimKey},
              'Referral Signup Reward',
              ${REFERRER_REWARD},
              NOW()
            )
        `;
      }


      const newUserClaimKey =
        `referral_new_user_${userId}`;

      const newUserAlready =
        await sql`
          SELECT id

          FROM reward_claims

          WHERE user_id = ${userId}
            AND reward_type = 'referral'
            AND reference_key =
                ${newUserClaimKey}

          LIMIT 1
        `;

      if (!newUserAlready.length) {

        await addCoins(
          userId,
          NEW_USER_REFERRAL_BONUS
        );

        await sql`
          INSERT INTO reward_claims
            (
              id,
              user_id,
              reward_type,
              reference_key,
              title,
              amount,
              created_at
            )

          VALUES
            (
              ${makeId()},
              ${userId},
              'referral',
              ${newUserClaimKey},
              'Referral Welcome Bonus',
              ${NEW_USER_REFERRAL_BONUS},
              NOW()
            )
        `;
      }
    }


    /* ---------------------------------------------
       LOGIN SESSION
    --------------------------------------------- */

    const token =
      makeToken();

    await sql`
      INSERT INTO admin_sessions
        (
          user_id,
          token,
          expires_at,
          created_at
        )

      VALUES
        (
          ${userId},
          ${token},
          NOW() + INTERVAL '30 days',
          NOW()
        )
    `;


    const wallet =
      await getWallet(userId);

    const walletData =
      walletResponse(wallet);

    const userData = {
      ...created[0],

      coins:
        walletData.balance,

      balance:
        walletData.balance,

      totalEarned:
        walletData.totalEarned,

      totalWithdrawn:
        walletData.totalWithdrawn,

      referralCode:
        created[0].referral_code
    };

    return send(res, 201, {
      success: true,

      message:
        referrer
          ? `Account created successfully. Referral bonus added: ${NEW_USER_REFERRAL_BONUS} coins.`
          : 'Account created successfully.',

      token,

      user:
        userData,

      wallet:
        walletData
    });

  } catch (error) {

    console.error(
      'REGISTER ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to create account.',
      error:
        error.message ||
        'Database error',
      code:
        error.code || null,
      detail:
        error.detail || null
    });
  }
}


/* =========================================================
   DASHBOARD
========================================================= */

async function handleDashboard(req, res) {
  try {

    const user =
      await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Authentication required.'
      });
    }

    const wallet =
      await getWallet(
        String(user.id)
      );

    return send(res, 200, {
      success: true,

      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,

        coins:
          Number(wallet.balance || 0),

        referral_code:
          user.referral_code,

        referralCode:
          user.referral_code,

        referred_by:
          user.referred_by
      },

      wallet:
        walletResponse(wallet)
    });

  } catch (error) {

    console.error(
      'DASHBOARD ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to load dashboard.',
      error:
        error.message
    });
  }
}


/* =========================================================
   WALLET
========================================================= */

async function handleWallet(req, res) {
  try {

    const user =
      await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Authentication required.'
      });
    }

    const wallet =
      await getWallet(
        String(user.id)
      );

    return send(res, 200, {
      success: true,

      wallet: {
        id: wallet.id,
        user_id: wallet.user_id,

        ...walletResponse(wallet),

        created_at:
          wallet.created_at,

        updated_at:
          wallet.updated_at
      }
    });

  } catch (error) {

    console.error(
      'WALLET ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to load wallet.',
      error:
        error.message
    });
  }
}


/* =========================================================
   CLAIM TASK / SURVEY
========================================================= */

async function handleClaimReward(
  body,
  req,
  res
) {
  try {

    const user =
      await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Please login first.'
      });
    }

    const rewardType =
      String(
        body.rewardType ||
        body.reward_type ||
        'task'
      )
        .trim()
        .toLowerCase();

    const referenceKey =
      String(
        body.rewardId ||
        body.reward_id ||
        body.referenceKey ||
        body.reference_key ||
        ''
      )
        .trim()
        .toLowerCase();

    const title =
      String(
        body.title ||
        body.rewardTitle ||
        `${rewardType} reward`
      )
        .trim();

    if (!referenceKey) {
      return send(res, 400, {
        success: false,
        message:
          'Reward ID is required.'
      });
    }

    let amount = 0;

    if (rewardType === 'task') {

      amount =
        Number(
          TASK_REWARDS[referenceKey] || 0
        );

    } else if (
      rewardType === 'survey'
    ) {

      amount =
        Number(
          SURVEY_REWARDS[referenceKey] || 0
        );

    } else if (
      rewardType === 'daily_bonus'
    ) {

      amount =
        DAILY_BONUS_AMOUNT;

    } else {

      return send(res, 400, {
        success: false,
        message:
          'Invalid reward type.'
      });
    }

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return send(res, 400, {
        success: false,
        message:
          'Invalid reward ID.'
      });
    }

    const userId =
      String(user.id);

    const alreadyClaimed =
      await sql`
        SELECT id

        FROM reward_claims

        WHERE user_id = ${userId}
          AND reward_type = ${rewardType}
          AND reference_key = ${referenceKey}

        LIMIT 1
      `;

    if (alreadyClaimed.length) {
      return send(res, 409, {
        success: false,
        message:
          'This reward has already been claimed.'
      });
    }

    const wallet =
      await getWallet(userId);

    const oldBalance =
      Number(wallet.balance || 0);

    const oldEarned =
      Number(wallet.total_earned || 0);

    const totalWithdrawn =
      Number(wallet.total_withdrawn || 0);

    const newBalance =
      oldBalance + amount;

    const newEarned =
      oldEarned + amount;

    await sql`
      UPDATE wallets

      SET
        balance = ${newBalance},
        total_earned = ${newEarned},
        updated_at = NOW()

      WHERE user_id = ${userId}
    `;

    await sql`
      UPDATE users

      SET coins = ${newBalance}

      WHERE id = ${userId}
    `;

    await sql`
      INSERT INTO reward_claims
        (
          id,
          user_id,
          reward_type,
          reference_key,
          title,
          amount,
          created_at
        )

      VALUES
        (
          ${makeId()},
          ${userId},
          ${rewardType},
          ${referenceKey},
          ${title},
          ${amount},
          NOW()
        )
    `;

    return send(res, 200, {
      success: true,

      message:
        `You earned ${amount} coins.`,

      reward: {
        type:
          rewardType,

        reference_key:
          referenceKey,

        title,

        amount
      },

      wallet: {
        balance:
          newBalance,

        total_earned:
          newEarned,

        total_withdrawn:
          totalWithdrawn,

        totalEarned:
          newEarned,

        totalWithdrawn
      }
    });

  } catch (error) {

    console.error(
      'REWARD CLAIM ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to process reward.',
      error:
        error.message ||
        'Database error',
      code:
        error.code || null,
      detail:
        error.detail || null
    });
  }
}


/* =========================================================
   DAILY BONUS
========================================================= */

async function handleDailyBonus(req, res) {
  try {

    const user =
      await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Please login first.'
      });
    }

    const rewardType =
      'daily_bonus';

    const referenceKey =
      'daily_' +
      new Date()
        .toISOString()
        .slice(0, 10);

    return handleClaimReward(
      {
        rewardType,
        rewardId:
          referenceKey,
        title:
          'Daily Bonus'
      },
      req,
      res
    );

  } catch (error) {

    console.error(
      'DAILY BONUS ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to claim daily bonus.',
      error:
        error.message
    });
  }
}


/* =========================================================
   REFERRAL STATS
========================================================= */

async function handleReferralStats(req, res) {
  try {

    const user =
      await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Authentication required.'
      });
    }

    const userId =
      String(user.id);

    const referred =
      await sql`
        SELECT
          id,
          name,
          username,
          created_at

        FROM users

        WHERE referred_by = ${userId}

        ORDER BY created_at DESC
      `;

    const earnings =
      await sql`
        SELECT
          COALESCE(
            SUM(amount),
            0
          ) AS total

        FROM reward_claims

        WHERE user_id = ${userId}
          AND reward_type = 'referral'
      `;

    return send(res, 200, {
      success: true,

      referralCode:
        user.referral_code,

      referral_code:
        user.referral_code,

      totalReferrals:
        referred.length,

      totalEarnings:
        Number(
          earnings[0]?.total || 0
        ),

      referrals:
        referred.map(item => ({
          id:
            item.id,

          name:
            item.name,

          username:
            item.username,

          created_at:
            item.created_at
        }))
    });

  } catch (error) {

    console.error(
      'REFERRAL STATS ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to load referral information.',
      error:
        error.message
    });
  }
}


/* =========================================================
   KYC STATUS
   IMPORTANT:
   Uses existing database columns:
   id bigint
   user_id text
   full_name text
   document_type text
   document_number text
   document_url text
   status text
   admin_note text
   submitted_at timestamptz
   reviewed_at timestamptz
========================================================= */

async function handleKycStatus(req, res) {
  try {

    const user =
      await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Authentication required.'
      });
    }

    const rows =
      await sql`
        SELECT
          id,
          user_id,
          full_name,
          document_type,
          document_number,
          document_url,
          status,
          admin_note,
          submitted_at,
          reviewed_at

        FROM kyc_submissions

        WHERE user_id = ${String(user.id)}

        ORDER BY submitted_at DESC

        LIMIT 1
      `;

    return send(res, 200, {
      success: true,
      kyc:
        rows[0] || null
    });

  } catch (error) {

    console.error(
      'KYC STATUS ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to load KYC status.',
      error:
        error.message ||
        'Database error'
    });
  }
}


/* =========================================================
   SUBMIT KYC
========================================================= */

async function handleSubmitKyc(
  body,
  req,
  res
) {
  try {

    const user =
      await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Please login first.'
      });
    }

    const fullName =
      String(
        body.fullName ||
        body.full_name ||
        ''
      ).trim();

    const documentType =
      String(
        body.documentType ||
        body.document_type ||
        'CNIC'
      ).trim();

    const documentNumber =
      String(
        body.documentNumber ||
        body.document_number ||
        body.cnic ||
        ''
      ).trim();

    const documentUrl =
      String(
        body.documentUrl ||
        body.document_url ||
        ''
      ).trim();

    if (!fullName) {
      return send(res, 400, {
        success: false,
        message:
          'Full name is required.'
      });
    }

    if (!documentNumber) {
      return send(res, 400, {
        success: false,
        message:
          'CNIC / document number is required.'
      });
    }

    if (!documentUrl) {
      return send(res, 400, {
        success: false,
        message:
          'Document URL is required.'
      });
    }

    const userId =
      String(user.id);

    const existing =
      await sql`
        SELECT
          id,
          status

        FROM kyc_submissions

        WHERE user_id = ${userId}

        ORDER BY submitted_at DESC

        LIMIT 1
      `;

    if (existing.length) {

      const oldStatus =
        String(
          existing[0].status || ''
        ).toLowerCase();

      if (oldStatus === 'pending') {
        return send(res, 409, {
          success: false,
          message:
            'Your KYC is already under review.'
        });
      }

      if (oldStatus === 'approved') {
        return send(res, 409, {
          success: false,
          message:
            'Your KYC is already approved.'
        });
      }
    }

    const created =
      await sql`
        INSERT INTO kyc_submissions
          (
            user_id,
            full_name,
            document_type,
            document_number,
            document_url,
            status,
            admin_note,
            submitted_at
          )

        VALUES
          (
            ${userId},
            ${fullName},
            ${documentType},
            ${documentNumber},
            ${documentUrl},
            'pending',
            NULL,
            NOW()
          )

        RETURNING
          id,
          user_id,
          full_name,
          document_type,
          document_number,
          document_url,
          status,
          admin_note,
          submitted_at,
          reviewed_at
      `;

    return send(res, 201, {
      success: true,

      message:
        'KYC submitted successfully. It is now under review.',

      kyc:
        created[0]
    });

  } catch (error) {

    console.error(
      'SUBMIT KYC ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to submit KYC.',
      error:
        error.message ||
        'Database error',
      code:
        error.code || null,
      detail:
        error.detail || null
    });
  }
}


/* =========================================================
   ADMIN KYC
========================================================= */

async function handleAdminKyc(req, res) {
  try {

    const admin =
      await getUserFromToken(req);

    if (
      !admin ||
      String(admin.role).toLowerCase() !== 'admin'
    ) {
      return send(res, 403, {
        success: false,
        message:
          'Admin access required.'
      });
    }


    /* ---------------------------------------------
       GET ALL KYC
    --------------------------------------------- */

    if (req.method === 'GET') {

      const rows =
        await sql`
          SELECT
            k.id,
            k.user_id,
            k.full_name,
            k.document_type,
            k.document_number,
            k.document_url,
            k.status,
            k.admin_note,
            k.submitted_at,
            k.reviewed_at,

            u.name AS user_name,
            u.username,
            u.email,
            u.phone

          FROM kyc_submissions k

          LEFT JOIN users u
            ON u.id = k.user_id

          ORDER BY
            k.submitted_at DESC
        `;

      return send(res, 200, {
        success: true,
        kyc:
          rows
      });
    }


    /* ---------------------------------------------
       APPROVE / REJECT
    --------------------------------------------- */

    const body =
      await readBody(req);

    const id =
      String(
        body.id || ''
      ).trim();

    const action =
      String(
        body.action || ''
      )
        .trim()
        .toLowerCase();

    const note =
      String(
        body.note ||
        body.adminNote ||
        ''
      ).trim();

    if (!id) {
      return send(res, 400, {
        success: false,
        message:
          'KYC ID is required.'
      });
    }

    if (
      action !== 'approve' &&
      action !== 'reject'
    ) {
      return send(res, 400, {
        success: false,
        message:
          'Action must be approve or reject.'
      });
    }


    const existing =
      await sql`
        SELECT
          id,
          user_id,
          status

        FROM kyc_submissions

        WHERE id = ${id}

        LIMIT 1
      `;

    if (!existing.length) {
      return send(res, 404, {
        success: false,
        message:
          'KYC submission not found.'
      });
    }

    const currentStatus =
      String(
        existing[0].status || ''
      ).toLowerCase();

    if (currentStatus !== 'pending') {
      return send(res, 409, {
        success: false,
        message:
          'This KYC has already been processed.'
      });
    }

    const newStatus =
      action === 'approve'
        ? 'approved'
        : 'rejected';

    const updated =
      await sql`
        UPDATE kyc_submissions

        SET
          status = ${newStatus},
          admin_note = ${note || null},
          reviewed_at = NOW()

        WHERE id = ${id}

        RETURNING
          id,
          user_id,
          full_name,
          document_type,
          document_number,
          document_url,
          status,
          admin_note,
          submitted_at,
          reviewed_at
      `;

    return send(res, 200, {
      success: true,

      message:
        action === 'approve'
          ? 'KYC approved successfully.'
          : 'KYC rejected successfully.',

      kyc:
        updated[0]
    });

  } catch (error) {

    console.error(
      'ADMIN KYC ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to process KYC.',
      error:
        error.message ||
        'Database error',
      code:
        error.code || null,
      detail:
        error.detail || null
    });
  }
}


/* =========================================================
   WITHDRAWAL
========================================================= */

async function handleWithdrawal(
  body,
  req,
  res
) {
  try {

    const user =
      await getUserFromToken(req);

    if (!user) {
      return send(res, 401, {
        success: false,
        message:
          'Please login first.'
      });
    }

    const amount =
      Number(body.amount || 0);

    const method =
      String(
        body.paymentMethod ||
        body.payment_method ||
        ''
      )
        .trim()
        .toLowerCase();

    const account =
      String(
        body.paymentAccount ||
        body.payment_account ||
        body.account ||
        ''
      ).trim();

    if (
      !Number.isInteger(amount) ||
      amount < MIN_WITHDRAWAL
    ) {
      return send(res, 400, {
        success: false,
        message:
          `Minimum withdrawal is ${MIN_WITHDRAWAL} coins.`
      });
    }

    const allowedMethods = [
      'easypaisa',
      'jazzcash',
      'bank'
    ];

    if (
      !allowedMethods.includes(method)
    ) {
      return send(res, 400, {
        success: false,
        message:
          'Invalid payment method.'
      });
    }

    if (!account) {
      return send(res, 400, {
        success: false,
        message:
          'Payment account is required.'
      });
    }

    const userId =
      String(user.id);

    const pending =
      await sql`
        SELECT id

        FROM withdrawals

        WHERE user_id = ${userId}
          AND status = 'pending'

        LIMIT 1
      `;

    if (pending.length) {
      return send(res, 409, {
        success: false,
        message:
          'You already have a pending withdrawal request.'
      });
    }

    const wallet =
      await getWallet(userId);

    const balance =
      Number(wallet.balance || 0);

    if (amount > balance) {
      return send(res, 400, {
        success: false,
        message:
          'Insufficient balance.'
      });
    }

    const newBalance =
      balance - amount;


    /* Reserve coins */

    await sql`
      UPDATE wallets

      SET
        balance = ${newBalance},
        updated_at = NOW()

      WHERE user_id = ${userId}
    `;

    await sql`
      UPDATE users

      SET coins = ${newBalance}

      WHERE id = ${userId}
    `;


    const withdrawalId =
      makeId();

    await sql`
      INSERT INTO withdrawals
        (
          id,
          user_id,
          amount,
          payment_method,
          payment_account,
          status,
          created_at,
          updated_at
        )

      VALUES
        (
          ${withdrawalId},
          ${userId},
          ${amount},
          ${method},
          ${account},
          'pending',
          NOW(),
          NOW()
        )
    `;

    const newWallet =
      await getWallet(userId);

    return send(res, 201, {
      success: true,

      message:
        'Withdrawal request submitted successfully.',

      withdrawal: {
        id:
          withdrawalId,

        amount,

        payment_method:
          method,

        payment_account:
          account,

        status:
          'pending'
      },

      wallet:
        walletResponse(newWallet)
    });

  } catch (error) {

    console.error(
      'WITHDRAWAL ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to submit withdrawal request.',
      error:
        error.message ||
        'Database error',
      code:
        error.code || null,
      detail:
        error.detail || null
    });
  }
}


/* =========================================================
   ADMIN WITHDRAWALS
========================================================= */

async function handleAdminWithdrawals(
  req,
  res
) {
  try {

    const admin =
      await getUserFromToken(req);

    if (
      !admin ||
      String(admin.role).toLowerCase() !== 'admin'
    ) {
      return send(res, 403, {
        success: false,
        message:
          'Admin access required.'
      });
    }


    /* GET */

    if (req.method === 'GET') {

      const rows =
        await sql`
          SELECT
            w.id,
            w.user_id,
            w.amount,
            w.payment_method,
            w.payment_account,
            w.status,
            w.admin_note,
            w.created_at,
            w.updated_at,
            w.reviewed_at,

            u.name AS user_name,
            u.username,
            u.email

          FROM withdrawals w

          LEFT JOIN users u
            ON u.id = w.user_id

          ORDER BY
            w.created_at DESC
        `;

      return send(res, 200, {
        success: true,

        withdrawals:
          rows
      });
    }


    /* POST */

    const body =
      await readBody(req);

    const id =
      String(
        body.id || ''
      ).trim();

    const action =
      String(
        body.action || ''
      )
        .trim()
        .toLowerCase();

    const note =
      String(
        body.note ||
        body.adminNote ||
        ''
      ).trim();

    if (!id) {
      return send(res, 400, {
        success: false,
        message:
          'Withdrawal ID is required.'
      });
    }

    if (
      action !== 'approve' &&
      action !== 'reject'
    ) {
      return send(res, 400, {
        success: false,
        message:
          'Invalid withdrawal action.'
      });
    }

    const rows =
      await sql`
        SELECT
          id,
          user_id,
          amount,
          status

        FROM withdrawals

        WHERE id = ${id}

        LIMIT 1
      `;

    if (!rows.length) {
      return send(res, 404, {
        success: false,
        message:
          'Withdrawal not found.'
      });
    }

    const withdrawal =
      rows[0];

    if (
      withdrawal.status !== 'pending'
    ) {
      return send(res, 409, {
        success: false,
        message:
          'This withdrawal has already been processed.'
      });
    }


    /* APPROVE */

    if (action === 'approve') {

      const updated =
        await sql`
          UPDATE withdrawals

          SET
            status = 'approved',
            admin_note = ${note || null},
            updated_at = NOW(),
            reviewed_at = NOW()

          WHERE id = ${id}

          RETURNING *
        `;

      await sql`
        UPDATE wallets

        SET
          total_withdrawn =
            total_withdrawn +
            ${Number(withdrawal.amount)},

          updated_at = NOW()

        WHERE user_id =
          ${String(withdrawal.user_id)}
      `;

      return send(res, 200, {
        success: true,

        message:
          'Withdrawal approved successfully.',

        withdrawal:
          updated[0]
      });
    }


    /* REJECT */

    const userId =
      String(withdrawal.user_id);

    const wallet =
      await getWallet(userId);

    const restoredBalance =
      Number(wallet.balance || 0) +
      Number(withdrawal.amount);

    await sql`
      UPDATE wallets

      SET
        balance = ${restoredBalance},
        updated_at = NOW()

      WHERE user_id = ${userId}
    `;

    await sql`
      UPDATE users

      SET coins = ${restoredBalance}

      WHERE id = ${userId}
    `;

    const updated =
      await sql`
        UPDATE withdrawals

        SET
          status = 'rejected',
          admin_note = ${note || null},
          updated_at = NOW(),
          reviewed_at = NOW()

        WHERE id = ${id}

        RETURNING *
      `;

    return send(res, 200, {
      success: true,

      message:
        'Withdrawal rejected and coins returned.',

      withdrawal:
        updated[0]
    });

  } catch (error) {

    console.error(
      'ADMIN WITHDRAWAL ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to process withdrawal.',
      error:
        error.message ||
        'Database error',
      code:
        error.code || null,
      detail:
        error.detail || null
    });
  }
}


/* =========================================================
   ADMIN STATS
========================================================= */

async function handleAdminStats(
  req,
  res
) {
  try {

    const admin =
      await getUserFromToken(req);

    if (
      !admin ||
      String(admin.role).toLowerCase() !== 'admin'
    ) {
      return send(res, 403, {
        success: false,
        message:
          'Admin access required.'
      });
    }

    const users =
      await sql`
        SELECT
          COUNT(*)::int AS count

        FROM users
      `;

    const coins =
      await sql`
        SELECT
          COALESCE(
            SUM(balance),
            0
          ) AS total

        FROM wallets
      `;

    const withdrawals =
      await sql`
        SELECT
          COUNT(*)::int AS count

        FROM withdrawals

        WHERE status = 'approved'
      `;

    const pendingWithdrawals =
      await sql`
        SELECT
          COUNT(*)::int AS count

        FROM withdrawals

        WHERE status = 'pending'
      `;

    const pendingKyc =
      await sql`
        SELECT
          COUNT(*)::int AS count

        FROM kyc_submissions

        WHERE status = 'pending'
      `;

    const totalReferrals =
      await sql`
        SELECT
          COUNT(*)::int AS count

        FROM users

        WHERE referred_by IS NOT NULL
      `;

    return send(res, 200, {
      success: true,

      stats: {
        totalUsers:
          Number(
            users[0]?.count || 0
          ),

        totalCoins:
          Number(
            coins[0]?.total || 0
          ),

        totalWithdrawals:
          Number(
            withdrawals[0]?.count || 0
          ),

        pendingWithdrawals:
          Number(
            pendingWithdrawals[0]?.count || 0
          ),

        pendingKyc:
          Number(
            pendingKyc[0]?.count || 0
          ),

        totalReferrals:
          Number(
            totalReferrals[0]?.count || 0
          )
      }
    });

  } catch (error) {

    console.error(
      'ADMIN STATS ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to load admin statistics.',
      error:
        error.message ||
        'Database error'
    });
  }
}


/* =========================================================
   ADMIN USERS
========================================================= */

async function handleAdminUsers(
  req,
  res
) {
  try {

    const admin =
      await getUserFromToken(req);

    if (
      !admin ||
      String(admin.role).toLowerCase() !== 'admin'
    ) {
      return send(res, 403, {
        success: false,
        message:
          'Admin access required.'
      });
    }

    const rows =
      await sql`
        SELECT
          id,
          name,
          username,
          email,
          phone,
          role,
          coins,
          created_at,
          referral_code,
          referred_by

        FROM users

        ORDER BY created_at DESC
      `;

    return send(res, 200, {
      success: true,
      users:
        rows
    });

  } catch (error) {

    console.error(
      'ADMIN USERS ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Unable to load users.',
      error:
        error.message ||
        'Database error'
    });
  }
}


/* =========================================================
   LOGOUT
========================================================= */

async function handleLogout(
  req,
  res
) {
  try {

    const token =
      getToken(req);

    if (token) {

      await sql`
        DELETE FROM admin_sessions

        WHERE token = ${token}
      `;
    }

    return send(res, 200, {
      success: true,
      message:
        'Logged out successfully.'
    });

  } catch (error) {

    console.error(
      'LOGOUT ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Logout failed.',
      error:
        error.message ||
        'Database error'
    });
  }
}


/* =========================================================
   MAIN API ROUTER
========================================================= */

module.exports = async function handler(
  req,
  res
) {

  if (req.method === 'OPTIONS') {
    return send(res, 200, {
      success: true
    });
  }

  try {

    const body =
      req.method === 'POST'
        ? await readBody(req)
        : {};

    const action =
      String(
        body.action ||
        req.query?.action ||
        ''
      )
        .trim()
        .toLowerCase();


    /* HEALTH */

    if (
      req.method === 'GET' &&
      !action
    ) {
      return send(res, 200, {
        success: true,
        service:
          'EarnNest API',
        status:
          'running'
      });
    }


    /* LOGIN */

    if (
      action === 'login' ||
      action === 'signin'
    ) {
      return handleLogin(
        body,
        res
      );
    }


    /* REGISTER */

    if (
      action === 'register' ||
      action === 'signup' ||
      action === 'create_account'
    ) {
      return handleRegister(
        body,
        res
      );
    }


    /* DASHBOARD */

    if (
      action === 'dashboard' ||
      action === 'get_dashboard' ||
      action === 'me'
    ) {
      return handleDashboard(
        req,
        res
      );
    }


    /* WALLET */

    if (
      action === 'wallet' ||
      action === 'get_wallet'
    ) {
      return handleWallet(
        req,
        res
      );
    }


    /* REWARD */

    if (
      action === 'claim_reward' ||
      action === 'complete_task' ||
      action === 'complete_survey'
    ) {
      return handleClaimReward(
        body,
        req,
        res
      );
    }


    /* DAILY BONUS */

    if (
      action === 'daily_bonus' ||
      action === 'claim_daily_bonus'
    ) {
      return handleDailyBonus(
        req,
        res
      );
    }


    /* REFERRAL */

    if (
      action === 'referral_stats' ||
      action === 'get_referral_stats'
    ) {
      return handleReferralStats(
        req,
        res
      );
    }


    /* KYC STATUS */

    if (
      action === 'kyc_status' ||
      action === 'get_kyc'
    ) {
      return handleKycStatus(
        req,
        res
      );
    }


    /* SUBMIT KYC */

    if (
      action === 'submit_kyc' ||
      action === 'kyc_submit'
    ) {
      return handleSubmitKyc(
        body,
        req,
        res
      );
    }


    /* WITHDRAWAL */

    if (
      action === 'withdraw' ||
      action === 'request_withdrawal' ||
      action === 'create_withdrawal'
    ) {
      return handleWithdrawal(
        body,
        req,
        res
      );
    }


    /* ADMIN STATS */

    if (
      action === 'admin_stats' ||
      action === 'get_admin_stats'
    ) {
      return handleAdminStats(
        req,
        res
      );
    }


    /* ADMIN USERS */

    if (
      action === 'admin_users' ||
      action === 'get_admin_users'
    ) {
      return handleAdminUsers(
        req,
        res
      );
    }


    /* ADMIN KYC */

    if (
      action === 'admin_kyc' ||
      action === 'get_admin_kyc'
    ) {
      return handleAdminKyc(
        req,
        res
      );
    }


    /* ADMIN WITHDRAWALS */

    if (
      action === 'admin_withdrawals' ||
      action === 'get_admin_withdrawals'
    ) {
      return handleAdminWithdrawals(
        req,
        res
      );
    }


    /* LOGOUT */

    if (
      action === 'logout'
    ) {
      return handleLogout(
        req,
        res
      );
    }


    /* UNKNOWN */

    return send(res, 400, {
      success: false,
      message:
        'Unknown API action.',
      action
    });

  } catch (error) {

    console.error(
      'API ERROR:',
      error
    );

    return send(res, 500, {
      success: false,
      message:
        'Server error.',
      error:
        error.message ||
        'Unknown error',
      code:
        error.code || null,
      detail:
        error.detail || null
    });
  }
};
