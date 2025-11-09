import pool from '../db/db.js';
import camelcaseKeys from 'camelcase-keys';

export async function getById(id) {
  const sql = `
    SELECT *
    FROM dbo."APIKeyManagement"
    WHERE "Id" = $1 AND "Active" = true
    LIMIT 1;
  `;
  const result = await pool.query(sql, [id]);
  if (result.rows.length === 0) return null;
  return camelcaseKeys(result.rows[0]);
}

export async function getAPIKey(name) {
  const sql = `
    SELECT *
    FROM dbo."APIKeyManagement"
    WHERE "Active" = true AND "Name" = $1
    ORDER BY "Usage" ASC
    LIMIT 1;
  `;
  const params = [name];
  const result = await pool.query(sql, params);
  if (result.rows.length === 0) return null;
  return camelcaseKeys(result.rows[0]);
}

export async function addAPIKey(email, name, apiKey) {
  const sql = `
    INSERT INTO dbo."APIKeyManagement" ("Email", "Name", "APIKey", "Usage", "Active")
    VALUES ($1,$2,$3,0,true)
    RETURNING "Id", "Email", "Name", "APIKey", "Usage", "Active";
  `;
  const params = [email, name, apiKey];
  const result = await pool.query(sql, params);
  return camelcaseKeys(result.rows[0]);
}

export async function markAsExpired(id) {
  const sql = `
    UPDATE dbo."APIKeyManagement" set "Active" = false WHERE "Id" = $1
    RETURNING "Id", "Email", "Name", "APIKey", "Usage", "Active";
  `;
  const params = [id];
  const result = await pool.query(sql, params);
  return camelcaseKeys(result.rows[0]);
}

export async function addUsage(id) {
  const sql = `
    UPDATE dbo."APIKeyManagement" set "Usage" = COALESCE("Usage", 0) + 1 WHERE "Id" = $1
    RETURNING "Id", "Email", "Name", "APIKey", "Usage", "Active";
  `;
  const params = [id];
  const result = await pool.query(sql, params);
  return camelcaseKeys(result.rows[0]);
}

export async function getAllAPIKey() {
  const sql = `
    SELECT *
    FROM dbo."APIKeyManagement"
    WHERE "Active" = true
    ORDER BY "Usage" DESC;
  `;
  const result = await pool.query(sql);
  return camelcaseKeys(result.rows);
}