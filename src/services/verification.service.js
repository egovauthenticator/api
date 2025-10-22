import pool from '../db/db.js';
import camelcaseKeys from 'camelcase-keys';

export async function getVerificationById(id) {
  // Parameterized Postgres query
  const sql = `
    SELECT *
    FROM dbo."Verification"
    WHERE "Id" = $1 
    LIMIT 1;
  `;
  const result = await pool.query(sql, [id]);
  if (result.rows.length === 0) return null;
  return camelcaseKeys(result.rows[0]);
}

export async function getVerificationByUser(userId, pageSize = 10, pageIndex = 0) {
  const size = Number(pageSize) > 0 ? Number(pageSize) : 10;
  const index = Number(pageIndex) >= 0 ? Number(pageIndex) : 0;
  const offset = index * size;
  const sql = `
    SELECT 
    v."Id", 
    v."Type", 
    v."Status", 
    v."Timestamp", 
    v."Data",
    json_build_object(
      'userId', u."UserId",
      'name', u."Name",
      'email', u."Email") as user,
    COUNT(*) OVER() AS total_rows
    FROM dbo."Verification" v
    LEFT JOIN dbo."User" u ON v."UserId" = u."UserId"
    WHERE v."UserId" = $1 
    AND v."Data"->>'id' IS NOT NULL AND v."Data"->>'id' <> ''
    AND v."Data"->>'name' IS NOT NULL AND v."Data"->>'name' <> ''
    AND v."Data"->>'firstName' IS NOT NULL AND v."Data"->>'firstName' <> ''
    AND v."Data"->>'lastName' IS NOT NULL AND v."Data"->>'lastName' <> ''
    AND v."Type" IN ('PSA', 'PHILSYS', 'VOTERS')
    ORDER BY v."Timestamp" DESC
    LIMIT $2 OFFSET $3;
  `;
  const result = await pool.query(sql, [userId, size, offset]);

  const totalRows = result.rows.length > 0 ? Number(result.rows[0].total_rows) : 0;

  return {
    total: totalRows,
    results: camelcaseKeys(result.rows),
  };
}

export async function createVerification(
  type,
  userId,
  data,
  status
) {
  const sql = `
    INSERT INTO dbo."Verification"(
    "Type", "UserId", "Data", "Status")
	VALUES ($1, $2, $3::jsonb, $4)
    RETURNING *;
  `;
  const params = [type, userId, data, status]; // Default OTP for now
  const result = await pool.query(sql, params);
  return camelcaseKeys(result.rows[0]);
}

export async function verifyPSARecords(firstName, lastName, sex, dateOfBirth) {
  const sql = `
    SELECT *
    FROM dbo."PSARecords"
    WHERE LOWER("FirstName") = LOWER($1)
      AND LOWER("LastName") = LOWER($2)
      AND LOWER("Sex") = LOWER($3)
      AND "DateOfBirth" = CAST($4 AS DATE);
  `;

  const result = await pool.query(sql, [
    firstName,
    lastName,
    sex,
    dateOfBirth, // format must be 'YYYY-MM-DD'
  ]);

  if (result.rows.length === 0) return null;
  return camelcaseKeys(result.rows[0]);
}

export async function verifyVoters(precintNumber, firstName, lastName) {
  // Parameterized Postgres query
  const sql = `
    SELECT *
    FROM dbo."VotersRecords"
    WHERE LOWER("PrecintNumber") = LOWER($1) AND LOWER("FirstName")= LOWER($2) AND LOWER("LastName") = LOWER($3);
  `;
  const result = await pool.query(sql, [precintNumber, firstName, lastName]);
  if (result.rows.length === 0) return null;
  return camelcaseKeys(result.rows[0]);
}
