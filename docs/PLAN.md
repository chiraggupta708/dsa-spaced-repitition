# Production Release & Rollback Plan — `dev` → `main`

**Design/context:** [`CODE-UNDERSTANDING.md`](CODE-UNDERSTANDING.md)

**Goal:** ship the verified `dev` UX + Designs work without risking the 31 existing production DSA cards, and retain a fast rollback path.

## Release baseline

- Current production Git SHA: `5f1efe3662fe672b03bce9afdedf1ba3c60523fe`
- Intended release candidate: `7126a5a51ffa55b4632c16ca89a24a7a38f9aeff` on `dev`
- Verified production backup: `/Users/chirag/Documents/dsa-spaced-repetition-backups/production-cards-2026-07-29_09-18-08_IST.json`
  - 31 cards, 171,649 bytes
  - SHA-256: `193f580d6f281f394708bfd5086323d1ffa27266d6228c1966a10be542de1016`

> **Safety invariant:** do not call `/api/import` or run `node test/api-test.js` against production. The test suite includes a full-import case, and Import intentionally replaces the card collection.

## 1. Prepare a clean release candidate

- [ ] Inspect the four local uncommitted items and either commit intentionally or discard them before opening a PR:
  - `package.json`, `package-lock.json`
  - `_bugs.md`, `mockup-modern.html`, `mockup.html`
- [ ] Confirm the PR diff only includes intended release work.

```bash
cd ~/dsa-spaced-repetition
git status --short
git diff -- package.json package-lock.json
git diff --stat origin/main...dev
git diff --check origin/main...dev
```

**Pass condition:** no accidental mockups/debug notes are included in the release.

## 2. Verify the existing `dev` deployment without writing production data

- [ ] In Vercel, confirm whether Preview and Production use the same Neon database. If they do, use read-only checks only.
- [ ] Confirm the dev deployment serves Designs and existing cards correctly.

```bash
# Replace DEV_URL with the existing Vercel dev deployment URL.
DEV_URL='https://<dev-deployment>.vercel.app'
for path in /api/health /api/stats /api/cards/due /api/designs; do
  printf '\n--- %s ---\n' "$path"
  curl --fail --silent --show-error "$DEV_URL$path"
done
```

**Pass condition:** health, stats, due-card list, and Designs all respond successfully. Do not create/review/import records when the DB is shared with production.

## 3. Review and merge via PR

- [ ] Open a PR from `dev` to `main`.
- [ ] Record the previous production deployment URL/ID from the Vercel dashboard before merging; it is the immediate rollback target.
- [ ] Merge only after the checks in steps 1–2 pass.

```bash
# Evidence only — do not push directly to main.
git fetch origin
git log --oneline origin/main..origin/dev
git diff --name-status origin/main...origin/dev
```

**Pass condition:** `main` contains the chosen release commit and Vercel starts a new production deployment.

## 4. Post-deploy, read-only production smoke check

- [ ] Wait for Vercel to mark the deployment Ready.
- [ ] Confirm existing data survived before performing any write actions.

```bash
PROD_URL='https://dsa-spaced-repitition.vercel.app'
for path in /api/health /api/stats /api/cards/due; do
  printf '\n--- %s ---\n' "$path"
  curl --fail --silent --show-error "$PROD_URL$path"
done
curl --fail --silent --show-error "$PROD_URL/api/export" \
  -o /tmp/dsa-production-post-deploy.json
python3 - <<'PY'
import json
with open('/tmp/dsa-production-post-deploy.json') as f:
    data = json.load(f)
assert isinstance(data.get('cards'), list), 'Missing cards array'
assert len(data['cards']) == 31, f"Expected 31 cards, got {len(data['cards'])}"
print('PASS: post-deploy export has 31 cards')
PY
```

**Pass condition:** health/stats/due endpoints return 200 and the exported card count remains **31**.

## 5. Activate and test Designs safely

`vercel.json` currently disables the build command, so `scripts/setup-db.mjs` is **not** run automatically during deployment. The Designs tables must be created deliberately, using the production Neon connection string.

- [ ] First confirm the production `DATABASE_URL`/`POSTGRES_URL` in Vercel points at the intended Neon database.
- [ ] Run the additive schema script once from a secure shell with that production connection string. It uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; it contains no `DROP`, `TRUNCATE`, or card-data deletes.

```bash
cd ~/dsa-spaced-repetition
DATABASE_URL='<production Neon URL>' node scripts/apply-schema.mjs
```

- [ ] Re-check `GET /api/designs`; then create one disposable test Design, verify it appears, and delete it.

**Pass condition:** Designs works and `/api/export` still reports 31 cards.

## 6. Roll back immediately if a release check fails

**Rollback triggers:** card count differs from 31; existing cards fail to load; a production endpoint returns 5xx; or the review UI is unusable.

1. Stop all write tests. Do **not** use Import as a quick fix.
2. In Vercel, promote the recorded prior deployment back to Production, or run:

```bash
vercel rollback '<previous-production-deployment-url-or-id>' --yes
```

3. Verify the restored deployment with the read-only checks from step 4.
4. Keep the DB schema in place: it is additive and the older code ignores the new tables/columns.
5. Only if card data is truly missing after investigation, restore the verified JSON backup through the UI Import flow, then validate count and card IDs.

## 7. Follow-up hardening (separate PR)

- [ ] Replace collection-level `save()` usage for normal create/edit/review operations with single-card SQL operations.
- [ ] Split Import into an explicit `replaceAllCards()` path with a server-side confirmation token/count check.
- [ ] Create a safe test mode that uses a disposable database or automatically restores its fixture; add `npm test` only after that.
- [ ] Update stale `DEPLOY.md`/README database instructions.

**Done means:** the new production deployment is healthy, card count is still 31, Designs works, and the previous Vercel deployment remains available as a tested rollback target.
