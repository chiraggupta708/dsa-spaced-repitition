import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';
import {
  LLD_LIFECYCLE_STATES,
  LLD_REVIEW_DIMENSIONS,
  LLD_REVIEW_LEVELS,
  normalizeLldReview,
} from './lld-contract.js';
import { normalizeLldAiInput, normalizeLldAiResponse } from './lld-ai.js';

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;
const sql = connectionString ? neon(connectionString) : null;

export const LLD_ATTEMPT_PHASES = Object.freeze([
  {
    key: 'scope',
    label: 'Requirements and scope',
    prompt: 'State the observable requirements, NFRs, assumptions, and explicit out-of-scope items.',
  },
  {
    key: 'model',
    label: 'Model and responsibilities',
    prompt: 'Name the core objects, one responsibility for each, and who owns mutable state.',
  },
  {
    key: 'code',
    label: 'Java classes and method contracts',
    prompt: 'Sketch the Java classes or interfaces, their ownership, and the method signatures that protect the main invariants.',
  },
  {
    key: 'diagram',
    label: 'Relationships and diagram',
    prompt: 'Explain the important relationships and how your diagram makes ownership visible.',
  },
  {
    key: 'flow_tradeoffs',
    label: 'Primary flow and tradeoffs',
    prompt: 'Walk through the happy path, one failure path, and one deliberate tradeoff.',
  },
  {
    key: 'review',
    label: 'Edge cases and extensibility',
    prompt: 'Name the highest-risk edge case, one extension, and the next thing you would test.',
  },
]);

const PHASE_KEYS = new Set(LLD_ATTEMPT_PHASES.map((phase) => phase.key));
const MAX_ANSWER_LENGTH = 20_000;
export const MAX_AI_TURNS_PER_ATTEMPT = 30;

function requireOwner(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim()) throw new Error('ownerId is required');
  return ownerId.trim();
}

function requireId(id, label) {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError(`${label} is required`);
  return id.trim();
}

function requireDatabase(action) {
  if (!sql) throw new Error(`DATABASE_URL not set — cannot ${action}`);
  return sql;
}

function phaseKey(value) {
  const key = requireId(value, 'phaseKey');
  if (!PHASE_KEYS.has(key)) throw new TypeError('phaseKey is not supported');
  return key;
}

function answerText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new TypeError('answerMd must be a string');
  if (value.length > MAX_ANSWER_LENGTH) throw new TypeError('answerMd is too large');
  return value;
}

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

function scheduledReviewAt(readinessState, now) {
  const days = { needs_review: 1, practicing: 3, interview_ready: 7 }[readinessState];
  if (!days) return null;
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function rowToAnswer(row) {
  return {
    id: row.id,
    phaseKey: row.phase_key,
    answerMd: row.answer_md || '',
    revealedAt: iso(row.revealed_at),
    submittedAt: iso(row.submitted_at),
    updatedAt: iso(row.updated_at),
  };
}

function rowToAiTurn(row) {
  let missingPoints = row.missing_points || [];
  let topImprovements = row.top_improvements || [];
  for (const [key, fallback] of [['missingPoints', missingPoints], ['topImprovements', topImprovements]]) {
    if (typeof fallback === 'string') {
      try {
        if (key === 'missingPoints') missingPoints = JSON.parse(fallback);
        else topImprovements = JSON.parse(fallback);
      } catch {
        if (key === 'missingPoints') missingPoints = [];
        else topImprovements = [];
      }
    }
  }
  return {
    id: row.id,
    phaseKey: row.phase_key || null,
    mode: row.mode,
    requestType: row.request_type,
    answerMd: row.answer_md || '',
    provider: row.provider || 'fallback',
    availability: row.provider === 'fallback' ? 'fallback' : 'live',
    assessment: row.assessment || 'partial',
    feedbackMd: row.feedback_md || '',
    missingPoints: Array.isArray(missingPoints) ? missingPoints : [],
    topImprovements: Array.isArray(topImprovements) ? topImprovements : [],
    nextDrill: row.next_drill || '',
    followUpQuestion: row.follow_up_question || '',
    hintMd: row.hint_md || '',
    createdAt: iso(row.created_at),
  };
}

function rowToAttempt(row, answers, aiTurns = []) {
  const answerMap = new Map(answers.map((answer) => [answer.phaseKey, answer]));
  return {
    id: row.id,
    designId: row.design_id,
    designTitle: row.design_title || '',
    mode: row.mode,
    status: row.status,
    promptVersion: row.prompt_version,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    updatedAt: iso(row.updated_at),
    phases: LLD_ATTEMPT_PHASES.map((phase) => ({
      ...phase,
      answer: answerMap.get(phase.key) || null,
    })),
    aiTurns,
  };
}

async function readAttempt(db, attemptId, ownerId) {
  const attemptRows = await db.query(
    `SELECT a.id, a.design_id, a.mode, a.status, a.prompt_version, a.started_at,
            a.completed_at, a.updated_at, d.title AS design_title
     FROM lld_attempts a
     JOIN lld_designs d ON d.id = a.design_id AND d.owner_id = a.owner_id
     WHERE a.id = $1 AND a.owner_id = $2`,
    [attemptId, ownerId]
  );
  if (!attemptRows.length) return null;
  const answerRows = await db.query(
    `SELECT id, phase_key, answer_md, revealed_at, submitted_at, updated_at
     FROM lld_attempt_answers
     WHERE attempt_id = $1 AND owner_id = $2
     ORDER BY created_at, phase_key`,
    [attemptId, ownerId]
  );
  const aiRows = await db.query(
    `SELECT id, phase_key, mode, request_type, answer_md, provider, assessment, feedback_md,
            missing_points, top_improvements, next_drill, follow_up_question, hint_md, created_at
     FROM lld_ai_turns
     WHERE attempt_id = $1 AND owner_id = $2
     ORDER BY created_at, id`,
    [attemptId, ownerId]
  );
  return rowToAttempt(
    attemptRows[0],
    answerRows.map(rowToAnswer),
    aiRows.map(rowToAiTurn),
  );
}

export async function createLldAttempt(designId, ownerId, mode = 'practice') {
  const owner = requireOwner(ownerId);
  const design = requireId(designId, 'designId');
  if (!['practice', 'timed'].includes(mode)) throw new TypeError('mode is not supported');
  const db = requireDatabase('start LLD attempt');
  const designRows = await db.query(
    'SELECT id FROM lld_designs WHERE id = $1 AND owner_id = $2',
    [design, owner]
  );
  if (!designRows.length) throw new Error('Design not found');
  const attemptId = `attempt_${crypto.randomUUID()}`;
  await db.query(
    `INSERT INTO lld_attempts (id, design_id, owner_id, mode, status, prompt_version)
     VALUES ($1, $2, $3, $4, 'started', 1)`,
    [attemptId, design, owner, mode]
  );
  return { attempt: await readAttempt(db, attemptId, owner) };
}

export async function getLldAttempt(attemptId, ownerId) {
  const owner = requireOwner(ownerId);
  const id = requireId(attemptId, 'attemptId');
  const db = requireDatabase('read LLD attempt');
  return { attempt: await readAttempt(db, id, owner) };
}

export async function saveLldAttemptAnswer(attemptId, ownerId, input) {
  const owner = requireOwner(ownerId);
  const id = requireId(attemptId, 'attemptId');
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const key = phaseKey(body.phaseKey);
  const answerMd = answerText(body.answerMd);
  const revealed = body.revealed === true;
  const db = requireDatabase('save LLD attempt answer');
  const attemptRows = await db.query(
    "SELECT id FROM lld_attempts WHERE id = $1 AND owner_id = $2 AND status = 'started'",
    [id, owner]
  );
  if (!attemptRows.length) throw new Error('Attempt not found or is no longer active');
  const now = new Date();
  await db.transaction([
    db`
      INSERT INTO lld_attempt_answers
        (id, attempt_id, owner_id, phase_key, answer_md, revealed_at, submitted_at, created_at, updated_at)
      VALUES
        (${`answer_${crypto.randomUUID()}`}, ${id}, ${owner}, ${key}, ${answerMd},
         ${revealed ? now : null}, ${now}, ${now}, ${now})
      ON CONFLICT (attempt_id, phase_key) DO UPDATE SET
        answer_md = EXCLUDED.answer_md,
        revealed_at = COALESCE(lld_attempt_answers.revealed_at, EXCLUDED.revealed_at),
        submitted_at = EXCLUDED.submitted_at,
        updated_at = EXCLUDED.updated_at
      WHERE lld_attempt_answers.owner_id = EXCLUDED.owner_id
    `,
    db`UPDATE lld_attempts SET updated_at = ${now} WHERE id = ${id} AND owner_id = ${owner}`,
  ]);
  return { attempt: await readAttempt(db, id, owner) };
}

export async function saveLldAiTurn(attemptId, ownerId, input, response) {
  const owner = requireOwner(ownerId);
  const id = requireId(attemptId, 'attemptId');
  const aiInput = normalizeLldAiInput(input);
  const aiResponse = normalizeLldAiResponse(response);
  const db = requireDatabase('save LLD AI feedback');
  const attemptRows = await db.query(
    `SELECT design_id FROM lld_attempts
     WHERE id = $1 AND owner_id = $2 AND status IN ('started', 'completed')`,
    [id, owner]
  );
  if (!attemptRows.length) throw new Error('Attempt not found');
  const countRows = await db.query(
    'SELECT COUNT(*)::int AS count FROM lld_ai_turns WHERE attempt_id = $1 AND owner_id = $2',
    [id, owner]
  );
  if (Number(countRows[0]?.count || 0) >= MAX_AI_TURNS_PER_ATTEMPT) {
    throw new Error('AI guidance limit reached for this attempt');
  }
  const now = new Date();
  const row = {
    id: `ai_${crypto.randomUUID()}`,
    phase_key: aiInput.phaseKey,
    mode: aiInput.mode,
    request_type: aiInput.requestType,
    answer_md: aiInput.answerMd,
    provider: aiResponse.provider,
    assessment: aiResponse.assessment,
    feedback_md: aiResponse.feedbackMd,
    missing_points: aiResponse.missingPoints,
    top_improvements: aiResponse.topImprovements,
    next_drill: aiResponse.nextDrill,
    follow_up_question: aiResponse.followUpQuestion,
    hint_md: aiResponse.hintMd,
    created_at: now,
  };
  await db.query(
    `INSERT INTO lld_ai_turns
      (id, attempt_id, design_id, owner_id, phase_key, mode, request_type, answer_md,
       feedback_md, missing_points, top_improvements, next_drill, follow_up_question, hint_md, assessment, provider, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17)`,
    [
      row.id,
      id,
      attemptRows[0].design_id,
      owner,
      row.phase_key,
      row.mode,
      row.request_type,
      row.answer_md,
      row.feedback_md,
      JSON.stringify(row.missing_points),
      JSON.stringify(row.top_improvements),
      row.next_drill,
      row.follow_up_question,
      row.hint_md,
      row.assessment,
      row.provider,
      now,
    ]
  );
  return { aiTurn: rowToAiTurn(row) };
}

export async function saveLldAttemptReview(attemptId, ownerId, input) {
  const owner = requireOwner(ownerId);
  const id = requireId(attemptId, 'attemptId');
  const review = normalizeLldReview(input);
  const db = requireDatabase('save LLD attempt review');
  const attemptRows = await db.query(
    'SELECT design_id FROM lld_attempts WHERE id = $1 AND owner_id = $2',
    [id, owner]
  );
  if (!attemptRows.length) throw new Error('Attempt not found');
  const designId = attemptRows[0].design_id;
  const now = new Date();
  const nextReviewAt = scheduledReviewAt(review.readinessStatus, now);
  const queries = [
    db`DELETE FROM lld_review_dimensions WHERE design_id = ${designId} AND owner_id = ${owner}`,
  ];
  review.dimensions.forEach((dimension) => {
    queries.push(db`
      INSERT INTO lld_review_dimensions
        (id, design_id, owner_id, dimension_key, level, notes_md, reviewed_at, updated_at)
      VALUES
        (${`review_${crypto.randomUUID()}`}, ${designId}, ${owner}, ${dimension.key}, ${dimension.level},
         ${dimension.notesMd}, ${now}, ${now})
    `);
  });
  queries.push(
    db`
      INSERT INTO lld_readiness
        (design_id, owner_id, readiness_state, next_action, next_review_at, algorithm_version, evaluated_at, updated_at)
      VALUES
        (${designId}, ${owner}, ${review.readinessStatus}, ${review.nextAction}, ${nextReviewAt}, 1, ${now}, ${now})
      ON CONFLICT (design_id) DO UPDATE SET
        readiness_state = EXCLUDED.readiness_state,
        next_action = EXCLUDED.next_action,
        next_review_at = EXCLUDED.next_review_at,
        algorithm_version = EXCLUDED.algorithm_version,
        evaluated_at = EXCLUDED.evaluated_at,
        updated_at = EXCLUDED.updated_at
      WHERE lld_readiness.owner_id = EXCLUDED.owner_id
    `,
    db`UPDATE lld_designs SET lifecycle_state = ${review.readinessStatus}, updated_at = ${now}
       WHERE id = ${designId} AND owner_id = ${owner}`,
  );
  await db.transaction(queries);
  return { attempt: await readAttempt(db, id, owner) };
}

export async function completeLldAttempt(attemptId, ownerId) {
  const owner = requireOwner(ownerId);
  const id = requireId(attemptId, 'attemptId');
  const db = requireDatabase('complete LLD attempt');
  await db.query(
    `UPDATE lld_attempts
     SET status = 'completed', completed_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND owner_id = $2 AND status = 'started'`,
    [id, owner]
  );
  return { attempt: await readAttempt(db, id, owner) };
}

export async function abandonLldAttempt(attemptId, ownerId) {
  const owner = requireOwner(ownerId);
  const id = requireId(attemptId, 'attemptId');
  const db = requireDatabase('abandon LLD attempt');
  await db.query(
    `UPDATE lld_attempts
     SET status = 'abandoned', updated_at = NOW()
     WHERE id = $1 AND owner_id = $2 AND status = 'started'`,
    [id, owner]
  );
  return { attempt: await readAttempt(db, id, owner) };
}

export { LLD_REVIEW_DIMENSIONS, LLD_REVIEW_LEVELS, LLD_LIFECYCLE_STATES };