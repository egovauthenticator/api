import pool from '../db/db.js';
import camelcaseKeys from 'camelcase-keys';

export async function findActiveUserByEmail(email) {
  // Parameterized Postgres query
  const sql = `
    SELECT *
    FROM dbo."User"
    WHERE "Email" = $1 AND "Active" = true
    LIMIT 1;
  `;
  const result = await pool.query(sql, [email]);
  if (result.rows.length === 0) return null;
  return camelcaseKeys(result.rows[0]);
}

export async function registerUser(name, email, otp, passwordHash) {
  const sql = `
    INSERT INTO dbo."User" ("Name", "Email", "CurrentOTP", "Password")
    VALUES ($1,$2,$3,$4)
    RETURNING "UserId", "Name", "Email", "CurrentOTP", "Active", "IsVerifiedUser";
  `;
  const params = [name, email, otp, passwordHash]; // Default OTP for now
  const result = await pool.query(sql, params);
  return camelcaseKeys(result.rows[0]);
}

export async function updateOTP(email, otp) {
  const sql = `
    UPDATE dbo."User" set "CurrentOTP" = $2 WHERE "Email" = $1
    RETURNING "UserId", "Name", "Email", "CurrentOTP", "Active", "IsVerifiedUser";
  `;
  const params = [email, otp]; // Default OTP for now
  const result = await pool.query(sql, params);
  return camelcaseKeys(result.rows[0]);
}

export async function markAsVerified(userId) {
  const sql = `
    UPDATE dbo."User" set "IsVerifiedUser" = true WHERE "UserId" = $1
    RETURNING "UserId", "Name", "Email", "CurrentOTP", "Active", "IsVerifiedUser";
  `;
  const params = [userId]; // Default OTP for now
  const result = await pool.query(sql, params);
  return camelcaseKeys(result.rows[0]);
}

export async function updatePassword(userId, passwordHash) {
  const sql = `
    UPDATE dbo."User" set "Password" = $2 WHERE "UserId" = $1
    RETURNING "UserId", "Name", "Email", "CurrentOTP", "Active", "IsVerifiedUser";
  `;
  const params = [userId, passwordHash]; // Default OTP for now
  const result = await pool.query(sql, params);
  return camelcaseKeys(result.rows[0]);
}