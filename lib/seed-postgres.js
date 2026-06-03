/**
 * seed-postgres.js — Seed the Postgres/Prisma database with sample cards.
 *
 * Usage:  npm run db:seed
 *         # or: node lib/seed-postgres.js
 *
 * Requires DATABASE_URL to be set in .env.
 * Run `npx prisma db push` or `npx prisma migrate dev` first to create tables.
 */

import { PrismaClient } from '../src/generated/prisma/client.ts';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Pool } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: DATABASE_URL is not set. Create a .env file with your Postgres connection string.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaNeon(pool);
const prisma = new PrismaClient({ adapter });

const sampleCards = [
  {
    id: 'seed-001',
    question: 'What is a closure in JavaScript?',
    link: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures',
    tags: ['javascript', 'basics'],
    difficulty: 'medium',
    actualCode: 'function outer() {\n  const x = 10;\n  return function inner() {\n    return x;\n  };\n}',
    myThinking: 'A function that remembers its lexical scope even when executed outside it.',
    rightThinking: 'Closures are function + its lexical environment bundled together.',
    notes: 'Every function in JS is a closure. Key for callbacks, modules.',
    easinessFactor: 2.5,
    interval: 1,
    repetitions: 1,
    nextReview: new Date(),
    lastReview: new Date(),
    lastQuality: 4,
  },
  {
    id: 'seed-002',
    question: 'What does Big O(n log n) mean?',
    link: '',
    tags: ['algorithms', 'complexity'],
    difficulty: 'hard',
    actualCode: '// Merge sort is O(n log n)\nfunction mergeSort(arr) { ... }',
    myThinking: 'Linearithmic time — happens with divide-and-conquer algorithms.',
    rightThinking: 'n log n means each element is processed in log n passes (e.g., tree depth).',
    notes: 'Common: mergesort, heapsort, quicksort average case.',
    easinessFactor: 2.0,
    interval: 0,
    repetitions: 0,
    nextReview: null,
    lastReview: null,
    lastQuality: null,
  },
  {
    id: 'seed-003',
    question: 'CSS: What is the difference between id and class?',
    link: '',
    tags: ['css', 'basics'],
    difficulty: 'easy',
    actualCode: '#unique { ... }\n.group { ... }',
    myThinking: 'id = unique per page, class = reusable. id has higher specificity.',
    rightThinking: 'Yes. id is #selector, class is .selector. Use classes for styling, ids for JS hooks.',
    notes: 'Avoid styling by id — specificity headaches.',
    easinessFactor: 2.8,
    interval: 6,
    repetitions: 2,
    nextReview: new Date(Date.now() + 6 * 86400000),
    lastReview: new Date(),
    lastQuality: 5,
  },
];

async function main() {
  console.log('Seeding Postgres database…');

  // Clear existing data
  await prisma.cardTag.deleteMany();
  await prisma.card.deleteMany();
  await prisma.tag.deleteMany();

  for (const card of sampleCards) {
    const { tags, ...cardData } = card;
    const tagRecords = [];

    for (const tagName of tags) {
      const tag = await prisma.tag.upsert({
        where: { name: tagName },
        update: {},
        create: { name: tagName },
      });
      tagRecords.push({ tagId: tag.id });
    }

    await prisma.card.create({
      data: {
        ...cardData,
        tags: { create: tagRecords },
      },
    });

    console.log(`  ✓ Created card "${cardData.question.slice(0, 50)}…"`);
  }

  const count = await prisma.card.count();
  console.log(`\nDone! Database now has ${count} card(s).`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());