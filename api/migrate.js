/**
 * One-time migration: add question_description column to cards table
 * Run: curl -X POST https://dsa-spaced-repitition.vercel.app/api/migrate
 * Or locally: curl -X POST http://localhost:3000/api/migrate
 */
import { neon } from '@neondatabase/serverless';

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'POST required' });
  }

  if (!connectionString) {
    res.statusCode = 400;
    return res.json({ ok: false, error: 'No database connection configured' });
  }

  try {
    const sql = neon(connectionString);

    // Add question_description column if it doesn't exist
    await sql`
      ALTER TABLE cards
      ADD COLUMN IF NOT EXISTS question_description TEXT NOT NULL DEFAULT '';
    `;

    res.json({ ok: true, message: 'Migration complete: added question_description column' });
  } catch (err) {
    res.statusCode = 500;
    res.json({ ok: false, error: err.message || 'Migration failed' });
  }
}
