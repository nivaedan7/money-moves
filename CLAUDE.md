# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**moneymoves** is a personal finance tracker built with Next.js (App Router) and TypeScript.

## Commands

```bash
npm run dev       # start dev server at http://localhost:3000
npm run build     # production build
npm run start     # start production server
npm run lint      # run ESLint
npx tsc --noEmit  # type-check without emitting
```

To run a single test file (once a test framework is added):
```bash
npx jest path/to/file.test.ts
# or with vitest:
npx vitest run path/to/file.test.ts
```

## Architecture

Next.js 14+ App Router project with the `app/` directory convention:

- `app/` — routes, layouts, and pages using Server Components by default
- `app/api/` — Route Handlers (API endpoints)
- `components/` — shared React components (client components marked with `"use client"`)
- `lib/` — utility functions, data fetching helpers, and business logic
- `types/` — shared TypeScript type definitions

Data flows: Server Components fetch and pass data down; client components handle interactivity. Keep data fetching in Server Components or Route Handlers; avoid redundant client-side fetches when server-side is sufficient.
