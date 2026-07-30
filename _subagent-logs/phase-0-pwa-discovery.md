# Phase 0C — PWA V1 discovery (READ-ONLY)

**Date:** 2026-07-29
**Repo:** `/Users/chirag/dsa-spaced-repetition`
**Scope:** Installable shell + fast load; journal data network-only. After auth UI.
**Application files modified:** NONE (log only; completed by parent after sub-agent stream failure)

---

## Baseline today

- `index.html`: no `manifest`, no `theme-color`, no `apple-touch-icon`, no SW register.
- `vercel.json`: version 2 only — no headers for SW.
- No `manifest.webmanifest` / `sw.js` / icons on disk.
- Docs mention PWA in `docs/superpowers/plans/2026-06-05-feature-plans.md` (Plan 5) — aspirational, not implemented.
- External scripts today: Marked + DOMPurify from jsDelivr (CDN). After auth: Clerk CDN too.

---

## Files to create (Phase 4)

| Path | Purpose |
|---|---|
| `manifest.webmanifest` | name, short_name, start_url `/`, display `standalone`, background/theme warm paper |
| `sw.js` | versioned cache; shell only |
| `icons/icon-192.png` | PWA + Android |
| `icons/icon-512.png` | splash / install |
| `icons/apple-touch-icon.png` | 180×180 iOS |
| `vercel.json` headers | `sw.js` → `Cache-Control: no-cache` (or `max-age=0, must-revalidate`) |

Optional: `icons/icon.svg` source if generating PNGs in a script.

### Manifest tokens (locked palette)

- `background_color`: `#f7f7f5`
- `theme_color`: `#f7f7f5` (or `#2563eb` if bar accent preferred — recommend paper for calm)
- `display`: `standalone`
- `start_url`: `/?source=pwa`
- `scope`: `/`
- `name`: `Coding Journal`
- `short_name`: `Journal`

---

## Cache allowlist (shell only)

Version cache name e.g. `cj-shell-v1`.

**Precache / runtime-cache OK:**

- `/`
- `/index.html`
- `/manifest.webmanifest`
- `/icons/*`
- `/sw.js` itself is not cached long-term (network-first via headers)

**Do NOT cache:**

- `/api/*` (all journal + auth config + leetcode)
- Any `Authorization` request
- Clerk origins / scripts (`*.clerk.accounts.dev`, `cdn.jsdelivr.net` clerk packages, `clerk.com`)
- CDN Marked/DOMPurify responses that might embed user-adjacent content — prefer network for third-party JS, or pin versions and accept shell-only without caching CDN if simpler
- Export/import blobs
- Service worker must use **network-only** for `fetch` when URL path starts with `/api/` or method is not GET for navigations to API

**Strategy:**

1. Install: precache allowlisted shell URLs only.
2. Fetch: if `/api/` or non-same-origin auth → `fetch(event.request)` only (no cache put).
3. Navigation offline: return cached `/index.html` shell; app JS shows reconnect banner when API fails.
4. Activate: delete old `cj-shell-*` caches.

---

## Offline UX

- Online: unchanged Quiet Study Desk.
- Offline / API fail after install: calm banner — “Reconnect to load your journal.” No fake empty journal from cache.
- No IndexedDB card store in V1.
- Sign-out (later): clear any user-specific client caches if added; shell cache may remain.

---

## `index.html` touch points (minimal — after auth)

1. `<head>`:
   - `<link rel="manifest" href="/manifest.webmanifest">`
   - `<meta name="theme-color" content="#f7f7f5">`
   - `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`
   - optional `apple-mobile-web-app-capable`
2. End of body script (after auth bootstrap):
   - `if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')`
3. Small offline banner element + `window` online/offline listeners (or detect failed `api()`).

**Conflict rule:** Phase 3 owns full `index.html` auth work. Phase 4 either waits or only adds head links + SW register in a final parent patch.

---

## `vercel.json` headers sketch

```json
{
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" },
        { "key": "Service-Worker-Allowed", "value": "/" }
      ]
    },
    {
      "source": "/manifest.webmanifest",
      "headers": [
        { "key": "Content-Type", "value": "application/manifest+json" }
      ]
    }
  ]
}
```

(Merge with existing `version` / build fields.)

---

## iOS Add to Home Screen

- Safari Share → Add to Home Screen (no install prompt API).
- Requires HTTPS, apple-touch-icon, preferably standalone-capable meta.
- Test: home screen launch opens `start_url` without browser chrome.

Android/Chrome: `beforeinstallprompt` optional later; manifest + SW enough for installability checklist.

---

## Database impact

**NONE.** No schema, no Neon changes for PWA V1.

---

## Phase 4 gate checklist

- [ ] Manifest serves 200 + valid JSON
- [ ] SW registers; updates on deploy (no-cache header)
- [ ] Offline: shell loads; API calls fail cleanly; no cached card JSON in Application → Cache Storage
- [ ] Lighthouse installable (or manual Chrome install criteria)
- [ ] Auth still works (Bearer not intercepted/cached)

---

## File content verified

- This log written by parent after task-2 stream failure.
- Re-read: YES (parent will re-read after write)
- Application files modified: NONE
