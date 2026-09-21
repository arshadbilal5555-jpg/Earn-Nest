'use strict';
process.env.RESET_DEFAULT_ADMIN = 'true';
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD before resetting the admin account.');
  process.exit(1);
}
require('./backend/server');
setTimeout(() => process.exit(0), 500);
