'use strict';

const crypto = require('crypto');

const users = new Map();
const resetCodes = new Map();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@earnnest.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'arshad@7326325';

users.set(ADMIN_EMAIL.toLowerCase(), {
  id: 'admin-001',
  name: 'EarnNest Admin',
  username: 'admin',
  email: ADMIN_EMAIL.toLowerCase(),
  phone: '',
  password: ADMIN_PASSWORD,
  role: 'admin',
  coins: 0
});


function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(data));
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
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}


function clean(value) {
  return String(value || '').trim();
}


function normalizeEmail(value) {
  return clean(value).toLowerCase();
}


function findUser(identifier) {
  const value = clean(identifier).toLowerCase();

  for (const user of users.values()) {
    if (
      user.email.toLowerCase() === value ||
      user.username.toLowerCase() === value
    ) {
      return user;
    }
  }

  return null;
}


function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone || '',
    role: user.role,
    coins: user.coins
  };
}


async function sendResetEmail(email, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.error('RESEND_API_KEY or EMAIL_FROM is not configured.');
    return false;
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'EarnNest Password Reset Code',
      html: `
        <div style="font-family:Arial,sans-serif">
          <h2>EarnNest Password Reset</h2>
          <p>Your password reset code is:</p>
          <h1 style="letter-spacing:5px">${code}</h1>
          <p>This code will expire in 10 minutes.</p>
          <p>If you did not request this reset, you can ignore this email.</p>
        </div>
      `
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Resend error:', errorText);
    return false;
  }

  return true;
}


module.exports = async (req, res) => {

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.end();
  }


  const path = req.url.split('?')[0];


  /*
   * HEALTH CHECK
   */
  if (req.method === 'GET' && path === '/api/health') {
    return send(res, 200, {
      ok: true,
      service: 'EarnNest API',
      status: 'running'
    });
  }


  /*
   * LOGIN
   */
  if (req.method === 'POST' && path === '/api/login') {
    try {

      const body = await readBody(req);

      const identifier = clean(body.email);
      const password = String(body.password || '');

      if (!identifier || !password) {
        return send(res, 400, {
          success: false,
          error: 'Email/username and password are required'
        });
      }

      const user = findUser(identifier);

      if (!user || user.password !== password) {
        return send(res, 401, {
          success: false,
          error: 'Invalid email/username or password'
        });
      }

      return send(res, 200, {
        success: true,
        message: 'Login successful',
        token: 'earn-nest-demo-token',
        user: publicUser(user)
      });

    } catch (error) {

      return send(res, 400, {
        success: false,
        error: error.message || 'Login request failed'
      });
    }
  }


  /*
   * REGISTER
   */
  if (req.method === 'POST' && path === '/api/register') {
    try {

      const body = await readBody(req);

      const name = clean(body.name);
      const username = clean(body.username).toLowerCase();
      const email = normalizeEmail(body.email);
      const phone = clean(body.phone);
      const password = String(body.password || '');
      const confirmPassword = String(
        body.confirmPassword || body.passwordConfirm || ''
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
          error: 'All registration fields are required'
        });
      }


      if (!email.includes('@')) {
        return send(res, 400, {
          success: false,
          error: 'Please enter a valid email address'
        });
      }


      if (username.length < 3) {
        return send(res, 400, {
          success: false,
          error: 'Username must be at least 3 characters'
        });
      }


      if (password.length < 6) {
        return send(res, 400, {
          success: false,
          error: 'Password must be at least 6 characters'
        });
      }


      if (password !== confirmPassword) {
        return send(res, 400, {
          success: false,
          error: 'Passwords do not match'
        });
      }


      if (users.has(email)) {
        return send(res, 409, {
          success: false,
          error: 'Email already registered'
        });
      }


      for (const existingUser of users.values()) {
        if (
          existingUser.username.toLowerCase() === username
        ) {
          return send(res, 409, {
            success: false,
            error: 'Username already taken'
          });
        }
      }


      const user = {
        id: 'user-' + crypto.randomUUID(),
        name,
        username,
        email,
        phone,
        password,
        role: 'user',
        coins: 0
      };


      users.set(email, user);


      return send(res, 201, {
        success: true,
        message: 'Registration successful',
        user: publicUser(user)
      });

    } catch (error) {

      return send(res, 400, {
        success: false,
        error: error.message || 'Registration failed'
      });
    }
  }


  /*
   * FORGOT PASSWORD
   */
  if (
    req.method === 'POST' &&
    path === '/api/forgot-password'
  ) {
    try {

      const body = await readBody(req);
      const email = normalizeEmail(body.email);

      if (!email) {
        return send(res, 400, {
          success: false,
          error: 'Email is required'
        });
      }


      const user = users.get(email);


      /*
       * Do not reveal whether an email exists.
       */
      if (!user) {
        return send(res, 200, {
          success: true,
          message:
            'If this email is registered, a reset code has been sent.'
        });
      }


      const code = String(
        Math.floor(100000 + Math.random() * 900000)
      );


      resetCodes.set(email, {
        code,
        expiresAt: Date.now() + 10 * 60 * 1000
      });


      const emailSent = await sendResetEmail(
        email,
        code
      );


      if (!emailSent) {
        resetCodes.delete(email);

        return send(res, 500, {
          success: false,
          error:
            'Password reset email could not be sent. Please check email configuration.'
        });
      }


      return send(res, 200, {
        success: true,
        message:
          'Password reset code sent to your email.'
      });

    } catch (error) {

      return send(res, 400, {
        success: false,
        error:
          error.message || 'Password reset request failed'
      });
    }
  }


  /*
   * RESET PASSWORD
   */
  if (
    req.method === 'POST' &&
    path === '/api/reset-password'
  ) {
    try {

      const body = await readBody(req);

      const email = normalizeEmail(body.email);
      const code = clean(body.code);
      const password = String(body.password || '');

      if (!email || !code || !password) {
        return send(res, 400, {
          success: false,
          error:
            'Email, reset code and new password are required'
        });
      }


      if (password.length < 6) {
        return send(res, 400, {
          success: false,
          error:
            'New password must be at least 6 characters'
        });
      }


      const reset = resetCodes.get(email);


      if (!reset) {
        return send(res, 400, {
          success: false,
          error:
            'Invalid or expired reset code'
        });
      }


      if (Date.now() > reset.expiresAt) {
        resetCodes.delete(email);

        return send(res, 400, {
          success: false,
          error:
            'Reset code has expired. Please request a new code.'
        });
      }


      if (reset.code !== code) {
        return send(res, 400, {
          success: false,
          error: 'Invalid reset code'
        });
      }


      const user = users.get(email);


      if (!user) {
        resetCodes.delete(email);

        return send(res, 400, {
          success: false,
          error: 'Account not found'
        });
      }


      user.password = password;

      users.set(email, user);

      resetCodes.delete(email);


      return send(res, 200, {
        success: true,
        message:
          'Password reset successfully. Please login.'
      });

    } catch (error) {

      return send(res, 400, {
        success: false,
        error:
          error.message || 'Password reset failed'
      });
    }
  }


  return send(res, 404, {
    success: false,
    error: 'API endpoint not found'
  });
};
