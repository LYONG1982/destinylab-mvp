# Destiny Lab MVP

Default local development branch: `codex/weapp-release-20261013`, tracking `origin/codex/weapp-release-20261013`. Use this branch for subsequent work unless the user explicitly chooses another branch.

All code changes require the user-approved plan in plans/active or plans/archive. The initial plan was explicitly approved on 2026-10-05. Do not modify the sibling legacy project.

Read relevant guides in node_modules/next/dist/docs before Next.js edits. Keep PRD, journey, data model, acceptance and change records current. Keep demo and server-backed data isolated; do not claim production or real WeChat acceptance from local tests.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
