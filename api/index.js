'use strict';

const crypto = require('crypto');

const users = new Map();
const resetCodes = new Map();
const adminSessions = new Map();

/* =========================
   ADMIN
========================= */

const ADMIN_EMAIL = String(
  process.env.ADMIN_EMAIL || 'admin@earnnest.com'
).trim().toLowerCase();

const ADMIN_PASSWORD = String(
  process.env.ADMIN_PASSWORD || ''
);

/* =========================
   DEFAULT ADMIN
========================= */

users.set(ADMIN_EMAIL, {
  id: 'admin-001',
  name: 'EarnNest Admin',
  username: 'admin',
  email: ADMIN_EMAIL,
  phone: '',
  password: ADMIN_PASSWORD,
  role: 'admin',
  coins: 0,
  createdAt: new Date().toISOString()
});

/* =========================
   RESPONSE
========================= */

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

/* =========================
   BODY
========================= */

function readBody(req) {
  return new Promise((resolve, reject) => {

    let body = '';

    req.on('data', chunk => {

      body += chunk;

      if (body.length > 1024 * 1024) {

        reject(
          new Error('Request too large')
        );

        req.destroy();
      }
    });

    req.on('end', () => {

      if (!body) {
        return resolve({});
      }

      try {

        resolve(JSON.parse(body));

      } catch {

        reject(
          new Error('Invalid JSON')
        );

      }

    });

    req.on('error', reject);

  });
}

/* =========================
   PUBLIC USER
========================= */

function publicUser(user) {

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
    coins: user.coins
  };

}

/* =========================
   FIND USER
========================= */

function findUser(login) {

  const value = String(login || '')
    .trim()
    .toLowerCase();

  if (!value) {
    return null;
  }

  for (const user of users.values()) {

    if (
      user.email.toLowerCase() === value ||
      String(user.username || '').toLowerCase() === value
    ) {

      return user;

    }

  }

  return null;
}

/* =========================
   ADMIN TOKEN
========================= */

function getBearerToken(req) {

  const authorization =
    req.headers.authorization || '';

  if (!authorization.startsWith('Bearer ')) {
    return '';
  }

  return authorization.substring(7).trim();
}

/* =========================
   ADMIN SESSION
========================= */

function getAdminSession(req) {

  const token =
    getBearerToken(req);

  if (!token) {
    return null;
  }

  const session =
    adminSessions.get(token);

  if (!session) {
    return null;
  }

  /*
    Session expiry:
    24 hours
  */

  const age =
    Date.now() - session.createdAt;

  if (age > 24 * 60 * 60 * 1000) {

    adminSessions.delete(token);

    return null;
  }

  return {
    token,
    ...session
  };
}

/* =========================
   RESEND
========================= */

async function sendResetEmail(
  email,
  code
) {

  const apiKey =
    process.env.RESEND_API_KEY;

  const from =
    process.env.EMAIL_FROM;

  /*
    Testing mode if Resend
    is not configured.
  */

  if (!apiKey || !from) {

    console.log(
      `EarnNest reset code for ${email}: ${code}`
    );

    return {
      sent: false,
      testing: true
    };
  }

  const response =
    await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',

        headers: {
          'Authorization':
            `Bearer ${apiKey}`,

          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({

          from: from,

          to: [email],

          subject:
            'EarnNest Password Reset Code',

          html: `
            <div style="font-family:Arial,sans-serif">
              <h2>EarnNest</h2>

              <p>
                You requested a password reset.
              </p>

              <p>
                Your verification code is:
              </p>

              <h1 style="letter-spacing:5px">
                ${code}
              </h1>

              <p>
                This code expires in 10 minutes.
              </p>

              <p>
                If you did not request this,
                you can ignore this email.
              </p>
            </div>
          `

        })

      }
    );

  if (!response.ok) {

    const errorText =
      await response.text();

    console.error(
      'Resend error:',
      errorText
    );

    throw new Error(
      'Unable to send password reset email'
    );
  }

  return {
    sent: true,
    testing: false
  };
}

/* =========================
   API
========================= */

module.exports = async (req, res) => {

  /* =========================
     OPTIONS
  ========================== */

  if (req.method === 'OPTIONS') {

    res.statusCode = 204;

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

    return res.end();
  }

  const path =
    req.url.split('?')[0];

  /* =========================
     HEALTH
  ========================== */

  if (
    req.method === 'GET' &&
    path === '/api/health'
  ) {

    return send(res, 200, {

      success: true,

      ok: true,

      service:
        'EarnNest API',

      status:
        'running'

    });

  }

  /* =========================
     LOGIN
  ========================== */

  if (
    req.method === 'POST' &&
    path === '/api/login'
  ) {

    try {

      const body =
        await readBody(req);

      const login =
        String(
          body.email ||
          body.username ||
          body.login ||
          ''
        ).trim();

      const password =
        String(
          body.password || ''
        );

      if (!login || !password) {

        return send(res, 400, {

          success: false,

          error:
            'Email/Username and password are required',

          message:
            'Email/Username and password are required'

        });

      }

      const user =
        findUser(login);

      if (!user) {

        return send(res, 401, {

          success: false,

          error:
            'Invalid email/username or password',

          message:
            'Invalid email/username or password'

        });

      }

      if (
        user.password !== password
      ) {

        return send(res, 401, {

          success: false,

          error:
            'Invalid email/username or password',

          message:
            'Invalid email/username or password'

        });

      }

      /*
        Generate session token
      */

      const token =
        crypto.randomUUID();

      /*
        Save admin session
      */

      if (
        user.role === 'admin'
      ) {

        adminSessions.set(
          token,
          {
            email: user.email,
            userId: user.id,
            role: user.role,
            createdAt: Date.now()
          }
        );

      }

      return send(res, 200, {

        success: true,

        message:
          'Login successful',

        token,

        user:
          publicUser(user)

      });

    } catch (error) {

      console.error(
        'Login error:',
        error
      );

      return send(res, 400, {

        success: false,

        error:
          error.message ||
          'Login request failed',

        message:
          error.message ||
          'Login request failed'

      });

    }

  }

  /* =========================
     REGISTER
  ========================== */

  if (
    req.method === 'POST' &&
    path === '/api/register'
  ) {

    try {

      const body =
        await readBody(req);

      const name =
        String(
          body.name || ''
        ).trim();

      const username =
        String(
          body.username || ''
        )
        .trim()
        .toLowerCase();

      const email =
        String(
          body.email || ''
        )
        .trim()
        .toLowerCase();

      const phone =
        String(
          body.phone || ''
        ).trim();

      const password =
        String(
          body.password || ''
        );

      const confirmPassword =
        String(
          body.confirmPassword ||
          body.confirm_password ||
          ''
        );

      if (
        !name ||
        !username ||
        !email ||
        !phone ||
        !password ||
        !confirmPassword
      ) {

        return send(res, 400, {

          success: false,

          error:
            'All fields are required',

          message:
            'All fields are required'

        });

      }

      if (name.length < 2) {

        return send(res, 400, {

          success: false,

          error:
            'Please enter your full name',

          message:
            'Please enter your full name'

        });

      }

      if (
        !/^[a-zA-Z0-9_.-]{3,30}$/
          .test(username)
      ) {

        return send(res, 400, {

          success: false,

          error:
            'Username must be 3-30 characters and contain only letters, numbers, underscore, dot or hyphen',

          message:
            'Username must be 3-30 characters and contain only letters, numbers, underscore, dot or hyphen'

        });

      }

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
          .test(email)
      ) {

        return send(res, 400, {

          success: false,

          error:
            'Please enter a valid email address',

          message:
            'Please enter a valid email address'

        });

      }

      if (phone.length < 7) {

        return send(res, 400, {

          success: false,

          error:
            'Please enter a valid phone number',

          message:
            'Please enter a valid phone number'

        });

      }

      if (password.length < 6) {

        return send(res, 400, {

          success: false,

          error:
            'Password must be at least 6 characters',

          message:
            'Password must be at least 6 characters'

        });

      }

      if (
        password !==
        confirmPassword
      ) {

        return send(res, 400, {

          success: false,

          error:
            'Passwords do not match',

          message:
            'Passwords do not match'

        });

      }

      if (users.has(email)) {

        return send(res, 409, {

          success: false,

          error:
            'Email already registered',

          message:
            'Email already registered'

        });

      }

      for (
        const existingUser
        of users.values()
      ) {

        if (
          String(
            existingUser.username || ''
          ).toLowerCase() === username
        ) {

          return send(res, 409, {

            success: false,

            error:
              'Username already taken',

            message:
              'Username already taken'

          });

        }

      }

      const user = {

        id:
          crypto.randomUUID(),

        name,

        username,

        email,

        phone,

        password,

        role:
          'user',

        coins:
          0,

        createdAt:
          new Date().toISOString()

      };

      users.set(
        email,
        user
      );

      return send(res, 201, {

        success: true,

        message:
          'Account created successfully',

        user:
          publicUser(user)

      });

    } catch (error) {

      console.error(
        'Register error:',
        error
      );

      return send(res, 400, {

        success: false,

        error:
          error.message ||
          'Registration failed',

        message:
          error.message ||
          'Registration failed'

      });

    }

  }

  /* =========================
     FORGOT PASSWORD
  ========================== */

  if (
    req.method === 'POST' &&
    path === '/api/forgot-password'
  ) {

    try {

      const body =
        await readBody(req);

      const email =
        String(
          body.email || ''
        )
        .trim()
        .toLowerCase();

      if (!email) {

        return send(res, 400, {

          success: false,

          error:
            'Email is required',

          message:
            'Email is required'

        });

      }

      const user =
        users.get(email);

      /*
        Don't reveal whether
        account exists.
      */

      if (!user) {

        return send(res, 200, {

          success: true,

          message:
            'If this email is registered, a reset code has been sent.'

        });

      }

      const code =
        String(
          Math.floor(
            100000 +
            Math.random() *
            900000
          )
        );

      const expiresAt =
        Date.now() +
        10 * 60 * 1000;

      resetCodes.set(
        email,
        {
          code,
          expiresAt
        }
      );

      const result =
        await sendResetEmail(
          email,
          code
        );

      const response = {

        success: true,

        message:
          'Password reset code sent to your email'

      };

      if (
        result.testing
      ) {

        response.testingCode =
          code;

        response.message =
          'Reset code generated for testing.';

      }

      return send(
        res,
        200,
        response
      );

    } catch (error) {

      console.error(
        'Forgot password error:',
        error
      );

      return send(res, 500, {

        success: false,

        error:
          error.message ||
          'Unable to send reset code',

        message:
          error.message ||
          'Unable to send reset code'

      });

    }

  }

  /* =========================
     RESET PASSWORD
  ========================== */

  if (
    req.method === 'POST' &&
    path === '/api/reset-password'
  ) {

    try {

      const body =
        await readBody(req);

      const email =
        String(
          body.email || ''
        )
        .trim()
        .toLowerCase();

      const code =
        String(
          body.code || ''
        ).trim();

      const newPassword =
        String(
          body.newPassword ||
          body.password ||
          ''
        );

      const confirmPassword =
        String(
          body.confirmPassword ||
          body.confirm_password ||
          ''
        );

      if (
        !email ||
        !code ||
        !newPassword ||
        !confirmPassword
      ) {

        return send(res, 400, {

          success: false,

          error:
            'All fields are required',

          message:
            'All fields are required'

        });

      }

      if (
        newPassword.length < 6
      ) {

        return send(res, 400, {

          success: false,

          error:
            'Password must be at least 6 characters',

          message:
            'Password must be at least 6 characters'

        });

      }

      if (
        newPassword !==
        confirmPassword
      ) {

        return send(res, 400, {

          success: false,

          error:
            'Passwords do not match',

          message:
            'Passwords do not match'

        });

      }

      const resetData =
        resetCodes.get(email);

      if (!resetData) {

        return send(res, 400, {

          success: false,

          error:
            'Reset code not found or expired',

          message:
            'Reset code not found or expired'

        });

      }

      if (
        Date.now() >
        resetData.expiresAt
      ) {

        resetCodes.delete(email);

        return send(res, 400, {

          success: false,

          error:
            'Reset code has expired',

          message:
            'Reset code has expired'

        });

      }

      if (
        resetData.code !== code
      ) {

        return send(res, 400, {

          success: false,

          error:
            'Invalid reset code',

          message:
            'Invalid reset code'

        });

      }

      const user =
        users.get(email);

      if (!user) {

        resetCodes.delete(email);

        return send(res, 400, {

          success: false,

          error:
            'Account not found',

          message:
            'Account not found'

        });

      }

      user.password =
        newPassword;

      resetCodes.delete(email);

      return send(res, 200, {

        success: true,

        message:
          'Password reset successfully'

      });

    } catch (error) {

      console.error(
        'Reset password error:',
        error
      );

      return send(res, 400, {

        success: false,

        error:
          error.message ||
          'Password reset failed',

        message:
          error.message ||
          'Password reset failed'

      });

    }

  }

  /* =========================
     ADMIN STATS
  ========================== */

  if (
    req.method === 'GET' &&
    path === '/api/admin/stats'
  ) {

    const session =
      getAdminSession(req);

    if (!session) {

      return send(res, 401, {

        success: false,

        error:
          'Unauthorized admin access',

        message:
          'Unauthorized admin access'

      });

    }

    if (
      session.role !== 'admin' ||
      session.email !== ADMIN_EMAIL
    ) {

      return send(res, 403, {

        success: false,

        error:
          'Admin access denied',

        message:
          'Admin access denied'

      });

    }

    const allUsers =
      Array.from(users.values());

    const normalUsers =
      allUsers.filter(
        user =>
          user.role !== 'admin'
      );

    let totalCoins = 0;

    normalUsers.forEach(
      user => {

        totalCoins +=
          Number(
            user.coins || 0
          );

      }
    );

    return send(res, 200, {

      success: true,

      stats: {

        totalUsers:
          normalUsers.length,

        totalCoins:
          totalCoins,

        totalWithdrawals:
          0,

        pendingKyc:
          0

      },

      users:
        normalUsers.map(
          publicUser
        )

    });

  }

  /* =========================
     ADMIN LOGOUT
  ========================== */

  if (
    req.method === 'POST' &&
    path === '/api/admin/logout'
  ) {

    const token =
      getBearerToken(req);

    if (token) {

      adminSessions.delete(
        token
      );

    }

    return send(res, 200, {

      success: true,

      message:
        'Admin logged out successfully'

    });

  }

  /* =========================
     404
  ========================== */

  return send(res, 404, {

    success: false,

    error:
      'API endpoint not found',

    message:
      'API endpoint not found',

    path

  });

};
