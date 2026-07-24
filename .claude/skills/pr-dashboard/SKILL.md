---
name: pr-dashboard
description: "Launch, configure, and troubleshoot the local PR dashboard — a React app that shows the GitHub pull requests you need to act on (to review, ready to merge, blocked, awaiting review, drafts) via your gh CLI auth. Use when the user wants to open/start their PR dashboard, scope it to specific GitHub orgs, or fix it when it shows nothing or errors."
argument-hint: "[orgs]"
---

# PR dashboard

A local dashboard of the GitHub PRs you need to act on. It shells out to the `gh` CLI on every
refresh, categorizes each PR (reviews to do, ready to merge, approved-but-blocked, awaiting review,
changes requested, drafts, …), and serves a React UI on `http://localhost:7337`.

Use this skill to **launch**, **configure** (which orgs), or **troubleshoot** it.

## Prerequisites

- `gh` authenticated — `gh auth status` (the dashboard has no auth of its own; it uses yours).
- Node 18+.

## Launch

```bash
cd ~/pr-dashboard && npm install && npm run dev
```

Opens `http://localhost:7337` automatically and auto-refreshes every 90s. Set `BROWSER=<app>` to
choose which browser opens it, or `PR_DASH_NO_OPEN=1` to not open one. Port `7337` is fixed
(`strictPort`); if it's taken, stop the other process or change the port in `vite.config.mjs`.

## Configure the orgs

By default it shows PRs across **all** orgs you touch. To scope it:

- **One-off**: `PR_DASH_ORGS=org-a,org-b npm run dev`.
- **Persistent**: write `pr-dashboard.config.json` at the repo root:

  ```json
  { "orgs": ["org-a", "org-b"] }
  ```

  (`pr-dashboard.config.example.json` is the template.) The env var wins over the file; an empty
  list means no filter. This config file is git-ignored — it's personal to your checkout.

## How it categorizes (so you can reason about what shows up)

It runs three `gh search prs` queries — authored by you, review-requested from you, reviewed by you
— then fetches details and buckets each PR:

- **Your PRs**: draft → `drafts`; approved + green + no conflict → `readyToMerge`; approved but
  conflicting/red → `approvedBlocked`; changes requested → `changesRequested`; else → `awaitingReview`.
- **Others' PRs**: review requested from you → `reviewsToDo`; you requested changes → `iBlocked`;
  else (you approved) → `iApproved`.

CI status per PR is summarized from the check rollup (failing / gated / running / passing).

## Troubleshoot

- **Empty dashboard** → check `gh auth status`; confirm your org filter isn't excluding everything
  (`echo $PR_DASH_ORGS`, inspect `pr-dashboard.config.json`); hit `/api/prs?force=1` to bypass the
  30s cache and read any error JSON.
- **Slow / rate-limited** → the server pools detail fetches (6 at a time) and caches for 30s; a very
  large PR set will be slower on first load.
- **Wrong CI/state** → the data mirrors `gh pr view --json …`; if `gh` shows it differently, the
  dashboard will too.

## Rules

- Read-only: this dashboard only *reads* GitHub via `gh`; it never merges, comments, or mutates.
- Never print or commit a `gh` token; `pr-dashboard.config.json` stays git-ignored.
