const { sql } = require("@vercel/postgres");

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.end(JSON.stringify(data));
}

function getToken(req) {
  const auth =
    req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) {
    return null;
  }

  return auth.substring(7).trim();
}

async function checkAdmin(req) {
  const token = getToken(req);

  if (!token) {
    return null;
  }

  try {

    const result = await sql`
      SELECT
        s.user_id,
        u.id,
        u.name,
        u.username,
        u.email,
        u.role
      FROM admin_sessions s
      JOIN users u
        ON u.id::text = s.user_id::text
      WHERE s.token = ${token}
        AND u.role = 'admin'
      LIMIT 1
    `;

    return result[0] || null;

  } catch (error) {

    console.error(
      "Admin check error:",
      error
    );

    return null;
  }
}

module.exports = async function handler(
  req,
  res
) {

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "GET") {
    return send(res, 405, {
      success: false,
      message: "Method not allowed"
    });
  }

  const admin =
    await checkAdmin(req);

  if (!admin) {
    return send(res, 403, {
      success: false,
      message: "Admin access required"
    });
  }

  try {

    /*
      Read the same withdrawals table
      used by the user withdrawal API.
    */

    const rows = await sql`
      SELECT
        w.*,
        u.name AS user_name,
        u.username AS user_username,
        u.email AS user_email
      FROM withdrawals w
      LEFT JOIN users u
        ON u.id::text = w.user_id::text
      ORDER BY w.created_at DESC
    `;

    const withdrawals =
      rows.map(function(w) {

        return {

          id: w.id,

          user_id:
            w.user_id || "",

          name:
            w.user_name || "",

          username:
            w.user_username || "",

          email:
            w.user_email || "",

          amount:
            Number(w.amount || 0),

          payment_method:
            w.payment_method || "",

          account_number:
            w.account_number || "",

          status:
            w.status || "pending",

          created_at:
            w.created_at || null

        };

      });

    return send(res, 200, {

      success: true,

      withdrawals:
        withdrawals

    });

  } catch (error) {

    console.error(
      "WITHDRAWAL DATABASE ERROR:",
      error
    );

    return send(res, 500, {

      success: false,

      message:
        "Unable to load withdrawals.",

      error:
        error.message || String(error)

    });

  }

};
