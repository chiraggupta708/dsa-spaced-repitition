# Coding Journal

A spaced-repetition coding journal for tracking problems, concepts, and review schedules (SM-2 algorithm).

Built with Node.js, deployed on Vercel.

## Postgres Database Setup

The project now uses **Postgres** via Prisma instead of the old JSON-file store.

### What was set up

- **Prisma** — ORM with schema in `prisma/schema.prisma`
- **`@neondatabase/serverless`** — the Vercel-recommended Postgres driver (Vercel Postgres is now powered by Neon)
- **Schema** — `cards`, `tags`, and `cards_tags` junction table
- **Migration scripts** — `npm run db:migrate`, `npm run db:push`, `npm run db:seed`
- **DB module** — `lib/db-postgres.js` (drop-in replacement for `lib/db.js`)

### One step needed from Vercel Dashboard

**You need to provision the database and grab the connection string:**

1. Go to the [Vercel Dashboard](https://vercel.com) → your project → **Storage** tab
2. Click **Create Database** → **Neon** (or **Vercel Postgres**)
3. After creation, copy your `DATABASE_URL` (with `?sslmode=require`)
4. Paste it in `.env`:

   ```
   DATABASE_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
   ```

5. Run the migration to create tables:

   ```bash
   npm run db:migrate
   ```

6. (Optional) Seed sample data:

   ```bash
   npm run db:seed
   ```

7. For Vercel deployments, add `DATABASE_URL` in **Settings → Environment Variables**

### Available scripts

| Script | Description |
|---|---|
| `npm start` | Run the dev server (JSON-file store) |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run Prisma migrations (dev) |
| `npm run db:push` | Push schema changes without migration |
| `npm run db:seed` | Seed the database with sample cards |
| `npm run db:studio` | Open Prisma Studio DB browser |

### Migration notes

- Switch your server/code from `lib/db.js` to `lib/db-postgres.js` once Postgres is ready
- The Postgres module exports the same `load()`, `save()` interface for drop-in compatibility
- Additional convenience queries: `getCard()`, `getDueCards()`, `getMasteredCards()`, `getStats()`, `countStreak()`