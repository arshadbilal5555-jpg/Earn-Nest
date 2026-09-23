const { sql } = require("@vercel/postgres");

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.end(JSON.stringify(data));
}

function getToken(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice(7).trim();
}

async function getAdmin(req) {
  const token = getToken(req);

  if (!token) {
    return null;
  }

  try {
    const rows = await sql`
      SELECT
        s.user_id,
        u.id,
        u.name,
        u.email,
        u.role
      FROM admin_sessions s
      JOIN users u
        ON u.id = s.user_id
      WHERE s.token = ${token}
        AND u.role = 'admin'
      LIMIT 1
    `;

    return rows[0] || null;

  } catch (error) {
    console.error("Admin authentication error:", error);
    return null;
  }
}

module.exports = async function handler(req, res) {

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

  const admin = await getAdmin(req);

  if (!admin) {
    return send(res, 403, {
      success: false,
      message: "Admin access required"
    });
  }

  try {

    /*
     * The user withdrawal API stores requests
     * in the `withdrawals` table.
     */

    const withdrawals = await sql`
      SELECT
        w.id,
        w.user_id,
        w.amount,
        w.payment_method,
        w.account_number,
        w.status,
        w.created_at,
        u.name,
        u.email,
        u.username
      FROM withdrawals w
      LEFT JOIN users u
        ON u.id::text = w.user_id::text
      ORDER BY w.created_at DESC
    `;

    return send(res, 200, {
      success: true,
      withdrawals: withdrawals.map(function(w) {

        return {
          id: w.id,
          user_id: w.user_id,
          name: w.name || "",
          username: w.username || "",
          email: w.email || "",
          amount: Number(w.amount || 0),
          payment_method: w.payment_method || "",
          account_number: w.account_number || "",
          status: w.status || "pending",
          created_at: w.created_at
        };

      })
    });

  } catch (error) {

    console.error(
      "Admin withdrawals error:",
      error
    );

    return send(res, 500, {
      success: false,
      message: "Unable to load withdrawals.",
      error: error.message
    });

  }

};
