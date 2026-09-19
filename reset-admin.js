'use strict';
process.env.RESET_DEFAULT_ADMIN = 'true';
if (!process.env.ADMIN_EMAIL) process.env.ADMIN_EMAIL = 'admin@earnnest.com';
if (!process.env.ADMIN_PASSWORD) process.env.ADMIN_PASSWORD = 'Admin@123';
require('./backend/server');
setTimeout(() => process.exit(0), 500);
