import pkg from 'pg';
import { env } from '../config/env.js';
import e from 'express';

const { Pool } = pkg;

const pool = new Pool({
  user: env.db.user,
  host: env.db.host,
  database: env.db.name,
  password: env.db.pass,
  port: env.db.port,
  ssl: env.db.ssl,
});

export default pool;
