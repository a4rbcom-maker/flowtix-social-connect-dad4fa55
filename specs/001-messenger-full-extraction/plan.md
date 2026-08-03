# Implementation Plan: Messenger Full Extraction

**Branch**: `001-messenger-full-extraction` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-messenger-full-extraction/spec.md`

## Summary

Fix the Facebook Messenger contact extraction to exhaustively capture ALL people who messaged a page — not just the first ~80. Replace the fragile GraphQL interception approach with a multi-layered strategy: (1) direct GraphQL API calls with cursor-based pagination using minimal, freshly-constructed requests, (2) targeted virtual-scroll of the Meta Business Suite Inbox conversation panel as backup, (3) proper deduplication, progress reporting, and clear failure logging. Remove all arbitrary limits that cause premature termination.

## Technical Context

**Language/Version**: TypeScript 5.6.3  
**Primary Dependencies**: Playwright 1.48 (headless Chromium), Express 4.21, Supabase JS 2.45, p-queue 8.0, Zod 3.23  
**Storage**: Supabase PostgreSQL — `extraction_jobs` (job status/progress), `extraction_results` (contacts)  
**Testing**: No test framework configured — manual verification via local job runs  
**Target Platform**: Node.js 22 on Windows, single headless Chromium browser instance  
**Project Type**: Web service (Express API) + React 19 frontend (Vite 6, Tailwind 4)  
**Performance Goals**: Extract 1,000+ contacts reliably; 5,000 contacts within 600s job timeout  
**Constraints**: 600s job timeout, 1 concurrent extraction job, single browser pool, must not break WhatsApp extraction  
**Scale/Scope**: Pages with 50 to 50,000 conversations

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| No breaking existing features | PASS | Changes are scoped to `messenger-contacts.ts`; WhatsApp path untouched |
| Error transparency | PASS | FR-7 mandates clear failure logging with specific stop reasons |
| Simplicity | PASS | Removes complex postData-capture logic in favor of minimal constructed requests |
| Deduplication | PASS | Already exists via `getExistingIds()`; enhanced with in-memory set |

**Gate Result**: ALL PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/001-messenger-full-extraction/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── extraction-api.md
└── tasks.md             # Phase 2 output (NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
extraction-service/
└── src/
    └── extractors/
        └── messenger-contacts.ts    # PRIMARY TARGET (~1030 lines → will be rewritten)

src/
├── pages/dashboard/extraction/
│   └── ExtractContactsPage.tsx       # Progress display wiring
├── lib/extraction/
│   └── extraction-repository.ts      # listJobs returns progress fields
└── types/
    └── database.types.ts             # Supabase-generated (may need recreation if columns added)

supabase/
└── migrations/
    └── *.sql                          # New migration for added columns (if needed)
```

**Structure Decision**: Single Web Application structure (frontend + backend). The extraction-service is a standalone Express app; frontend is Vite/React. Changes are concentrated in `messenger-contacts.ts` with minor wiring in the frontend.

## Complexity Tracking

> No violations to justify.
