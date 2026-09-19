# Exact Problem Count, Stable Profile, and Safe Search Design

**Date:** 2026-09-19

## Goal

Show the exact number of saved DSA problems without downloading the full library, keep the bottom-left Clerk profile control mounted reliably for the full signed-in session, and make Library search safely handle literal wildcard characters.

## Scope

- Extend the existing DSA practice summary with an exact owner-scoped card count.
- Render that exact count in the Today metrics and DSA navigation.
- Keep all problem lists cursor-paginated and body-free.
- Repair the existing parameterized title, URL, and tag search without widening its response.
- Mount the Clerk user button once per signed-in identity.
- Unmount Clerk UI only when signing out or changing accounts.
- Preserve the existing 12 Vercel serverless entry files.

The change does not add an endpoint, fetch full cards, alter scheduling, change Clerk configuration, or replace Clerk's account menu.

## Exact-count data flow

`getPracticeSummary(ownerId)` already materializes one lightweight row per card and calculates practice aggregates. Add `COUNT(*) AS total_count` to that same aggregate query and expose it as `summary.totalCount` through `toPracticeSummary`.

The browser continues to make one bounded summary request:

```text
GET /api/practice?view=summary
```

The response gains one integer. Library, recall, and independent-solve lists remain cursor-paginated and transfer only the current lightweight page. No client-side accumulation or full-list request is allowed.

The DSA count renderer uses `summary.totalCount` for both the saved-problems metric and the Problem Library navigation badge. It may show an em dash only until the summary request completes or if the request fails; it must never derive a total from `page.items.length` or `hasMore`.

## Stable Clerk profile lifecycle

Clerk can emit repeated listener updates while the signed-in identity remains unchanged. The current code clears `#userButton` and calls `mountUserButton` for every notification, which can detach Clerk-managed nodes and causes the observed delayed disappearance and `removeChild` errors.

Track the identity for which the user button is mounted. On a repeated signed-in update for the same identity:

- keep the existing Clerk component mounted;
- keep the private app visible;
- notify the DSA workspace only when needed;
- avoid clearing or remounting `#userButton`.

On sign-out or a real account change:

- call Clerk's matching unmount method for the user button when available;
- clear the mount container only after unmounting;
- reset the mounted-identity marker;
- then mount the correct signed-out or new-account UI once.

This is a lifecycle fix only. Clerk keys, provider settings, styles, and authentication behavior remain unchanged.

## Safe bounded Library search

The current parameterized `ILIKE` clauses produce a two-character PostgreSQL escape string, which is rejected because `ESCAPE` requires exactly one character. Use `!` as the explicit escape marker instead of a backslash.

Before wrapping the query in `%` wildcards, escape user-entered `!`, `%`, and `_` as `!!`, `!%`, and `!_`. Apply `ESCAPE '!'` consistently to title, URL, and tag matching. These characters therefore behave as literal search text rather than SQL wildcards.

Search keeps the existing 250 ms client debounce, owner scope, parameterized values, cursor pagination, ten-row page limit, lightweight summary DTO, and continuation metadata. It must not fetch complete card bodies, accumulate every page, or add a second request.

## Error handling

- A failed summary request keeps the current error banner behavior and leaves the total as unavailable rather than inventing a value.
- A valid search with no match returns the existing empty state; database failures keep the existing retry/error presentation.
- Failure to mount the Clerk control continues to show the existing account-menu toast.
- Unmount operations are guarded because Clerk may not have completed a prior mount.
- Account switches continue to clear private cached state before loading the next identity.

## Verification

Per the user's standing instruction, add no new automated tests. Update existing source-contract assertions only where their expected summary shape changes.

Run the complete existing build and contract suite, confirm the API entry count remains 12, then perform authenticated browser checks:

- the saved-problems metric and navigation badge show the exact database count;
- Library still loads only ten lightweight rows per page;
- title, URL, and tag searches work, while `!`, `%`, and `_` are treated literally;
- repeated Clerk listener activity does not remove the profile avatar;
- sign-out/account-boundary behavior remains intact;
- browser logs no longer receive the app-triggered Clerk `removeChild` error during repeated signed-in updates.
