import pool from "../db/db.js";
import camelcaseKeys from "camelcase-keys";

export async function getUserById(userId) {
  const sql = `
    SELECT *
    FROM dbo."User"
    WHERE "UserId" = $1 AND "Active" = true
    LIMIT 1;
  `;
  const result = await pool.query(sql, [userId]);
  if (result.rows.length === 0) return null;
  return camelcaseKeys(result.rows[0]);
}

export async function updateUser(userId, name, email) {
  const sql = `
    UPDATE dbo."User"
    SET
    "Name" = $2,
    "Email" = $3
    WHERE "UserId" = $1
    RETURNING *;
  `;
  const params = [userId, name, email];

  const result = await pool.query(sql, params);
  return camelcaseKeys(result.rows[0]);
}