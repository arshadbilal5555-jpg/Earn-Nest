'use strict';

const users = new Map();

const ADMIN_EMAIL = 'admin@earnnest.com';
const ADMIN_PASSWORD = 'Admin@123';

users.set(ADMIN_EMAIL, {
  id: 'admin-001',
  name: 'EarnNest Admin',
  email: ADMIN_EMAIL,
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

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.end();
  }

  const path = req.url.split('?')[0];

  if (req.method === 'GET' && path === '/api/health') {
    return send(res, 200, {
      ok: true,
      service: 'EarnNest API',
      status: 'running'
    });
  }

  if (req.method === 'POST' && path === '/api/login') {
    try {
      const body = await readBody(req);

      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!email || !password) {
        return send(res, 400, {
          success: false,
          message: 'Email and password are required'
        });
      }

      const user = users.get(email);

      if (!user || user.password !== password) {
        return send(res, 401, {
          success: false,
          message: 'Invalid email or password'
        });
      }

      return send(res, 200, {
        success: true,
        message: 'Login successful',
        token: 'earn-nest-demo-token',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          coins: user.coins
        }
      });
    } catch (error) {
      return send(res, 400, {
        success: false,
        message: error.message || 'Login request failed'
      });
    }
  }

  if (req.method === 'POST' && path === '/api/register') {
    try {
      const body = await readBody(req);

      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!name || !email || !password) {
        return send(res, 400, {
          success: false,
          message: 'Name, email and password are required'
        });
      }

      if (password.length < 6) {
        return send(res, 400, {
          success: false,
          message: 'Password must be at least 6 characters'
        });
      }

      if (users.has(email)) {
        return send(res, 409, {
          success: false,
          message: 'Email already registered'
        });
      }

      const user = {
        id: 'user-' + Date.now(),
        name,
        email,
        password,
        role: 'user',
        coins: 0
      };

      users.set(email, user);

      return send(res, 201, {
        success: true,
        message: 'Registration successful',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          coins: user.coins
        }
      });
    } catch (error) {
      return send(res, 400, {
        success: false,
        message: error.message || 'Registration failed'
      });
    }
  }

  return send(res, 404, {
    success: false,
    message: 'API endpoint not found'
  });
};
