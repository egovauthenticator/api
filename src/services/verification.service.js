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

export async function getVerificationByUser(q, type, userId, pageSize = 10, pageIndex = 0) {
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
    WHERE v."UserId" = $3 
    AND v."Data"->>'id' IS NOT NULL AND v."Data"->>'id' <> ''
    AND v."Data"->>'name' IS NOT NULL AND v."Data"->>'name' <> ''
    AND v."Data"->>'firstName' IS NOT NULL AND v."Data"->>'firstName' <> ''
    AND v."Data"->>'lastName' IS NOT NULL AND v."Data"->>'lastName' <> ''
    AND 
      (
        COALESCE($1, '') = '' OR
        LOWER(v."Data"->>'name') ILIKE '%' || $1 || '%' OR
        LOWER(v."Data"->>'firstName') ILIKE '%' || $1 || '%' OR
        LOWER(v."Data"->>'middleName') ILIKE '%' || $1 || '%' OR
        LOWER(v."Data"->>'lastName') ILIKE '%' || $1 || '%' OR
        LOWER(v."Data"->>'id') ILIKE '%' || $1 || '%' OR
        LOWER(v."Data"->>'address') ILIKE '%' || $1 || '%' OR
        LOWER(v."Data"->>'precintNo') ILIKE '%' || $1 || '%' OR
        LOWER(v."Data"->>'votersIdNumber') ILIKE '%' || $1 || '%' OR
        LOWER(v."Data"->>'id') ILIKE '%' || $1 || '%' OR
        LOWER(v."Data"->>'others') ILIKE '%' || $1 || '%'
      )
    AND ($2::text[] IS NULL OR v."Type" = ANY($2))
    AND v."Active" = true
    ORDER BY v."Timestamp" DESC
    LIMIT $4 OFFSET $5;
  `;
  const result = await pool.query(sql, [q.toLowerCase()?.trim(), type, userId, size, offset]);

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
    WHERE (TRIM(LOWER("FirstName")) ILIKE '%' || TRIM(LOWER($1)) || '%'
      AND TRIM(LOWER("LastName")) ILIKE '%' || TRIM(LOWER($2)) || '%'
      AND "DateOfBirth" = CAST($4 AS DATE)) OR (TRIM(LOWER("FirstName")) ILIKE '%' || TRIM(LOWER($1)) || '%'
      AND TRIM(LOWER("LastName")) ILIKE '%' || TRIM(LOWER($2)) || '%'
      AND "DateOfBirth" = CAST($4 AS DATE) AND TRIM(LOWER("Sex")) = TRIM(LOWER($3)));
  `;

  const result = await pool.query(sql, [
    firstName,
    lastName,
    sex,
    dateOfBirth, // must be 'YYYY-MM-DD'
  ]);

  if (result.rows.length === 0) return null;
  return camelcaseKeys(result.rows[0]);
}

export async function verifyVoters(precintNumber, firstName, lastName) {
  // Parameterized Postgres query
  const sql = `
    SELECT *
    FROM dbo."VotersRecords"
    WHERE TRIM(LOWER("PrecintNumber")) = TRIM(LOWER($1)) AND TRIM(LOWER("FirstName"))= TRIM(LOWER($2)) AND TRIM(LOWER("LastName")) = TRIM(LOWER($3));
  `;
  const result = await pool.query(sql, [precintNumber, firstName, lastName]);
  if (result.rows.length === 0) return null;
  return camelcaseKeys(result.rows[0]);
}

export async function deleteVerification(id) {
  const sql = `
  UPDATE dbo."Verification" SET "Active" = false WHERE "Id" = $1;
`;
  const params = [id];
  const result = await pool.query(sql, params);
  return camelcaseKeys(result.rows[0]);
}

