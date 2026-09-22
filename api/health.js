'use strict';

const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

module.exports = async (req, res) => {
  try {
    const result = await sql`
      SELECT NOW() AS database_time
    `;

    res.status(200).json({
      ok: true,
      success: true,
      service: 'EarnNest API',
      status: 'running',
      database: 'connected',
      databaseTime: result[0].database_time
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      success: false,
      service: 'EarnNest API',
      status: 'error',
      database: 'disconnected',
      error: error.message
    });
  }
};
