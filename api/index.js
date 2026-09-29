async function ensureRewardTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS reward_claims (
      id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      reward_type TEXT NOT NULL,
      reward_id TEXT NOT NULL,
      coins INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Existing old table mein missing columns add karein
  await sql`
    ALTER TABLE reward_claims
    ADD COLUMN IF NOT EXISTS user_id TEXT
  `;

  await sql`
    ALTER TABLE reward_claims
    ADD COLUMN IF NOT EXISTS reward_type TEXT
  `;

  await sql`
    ALTER TABLE reward_claims
    ADD COLUMN IF NOT EXISTS reward_id TEXT
  `;

  await sql`
    ALTER TABLE reward_claims
    ADD COLUMN IF NOT EXISTS coins INTEGER
  `;

  await sql`
    ALTER TABLE reward_claims
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
  `;

  // Old records ki wajah se NULL problem na aaye
  await sql`
    UPDATE reward_claims
    SET reward_type = COALESCE(reward_type, 'task')
    WHERE reward_type IS NULL
  `;

  await sql`
    UPDATE reward_claims
    SET reward_id = COALESCE(reward_id, 'legacy-' || id::text)
    WHERE reward_id IS NULL
  `;

  await sql`
    UPDATE reward_claims
    SET coins = COALESCE(coins, 0)
    WHERE coins IS NULL
  `;
}
