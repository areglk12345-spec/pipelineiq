import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

const ssl = process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;

// Runtime queries go through the transaction pooler (many short-lived
// connections); migrate.ts/seed.ts use the session pooler (DIRECT_URL)
// since schema changes and multi-statement transactions want a stable
// session rather than a pgbouncer transaction-mode connection.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });

export const migrationPool = new Pool({
  connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  ssl,
});
