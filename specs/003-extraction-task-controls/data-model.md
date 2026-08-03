# Data Model: Extraction Task Controls

**Date**: 2026-07-29

---

## Entities

### ExtractionJob

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID (PK) | Job identifier |
| `workspace_id` | UUID (FK) | Workspace isolation key |
| `user_id` | UUID (FK) | Owning user |
| `type` | Enum: `groups`, `pages`, `post_comments`, `post_reactions`, `messenger_contacts` | Extraction type |
| `source` | TEXT | Target URL |
| `name` | TEXT | Human-readable job name |
| `status` | Enum: `queued`, `running`, `completed`, `failed`, `paused`, `canceled` | Current job state |
| `result_count` | INTEGER (default 0) | Number of extracted contacts |
| `config` | JSONB | `{ max_results, skip_duplicates, session_id, cursor? }` |
| `error` | TEXT (nullable) | Error message if failed |
| `started_at` | TIMESTAMPTZ (nullable) | When extraction began |
| `completed_at` | TIMESTAMPTZ (nullable) | When extraction ended (completed, failed, or stopped) |
| `created_at` | TIMESTAMPTZ (default now) | Record creation time |

### ExtractionResult

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID (PK) | Result record identifier |
| `job_id` | UUID (FK → ExtractionJob) | Parent job |
| `workspace_id` | UUID (FK) | Workspace isolation key |
| `fb_id` | TEXT | Facebook user/page ID |
| `type` | TEXT | `"member"`, `"follower"`, `"commenter"`, `"reactor"`, `"contact"` |
| `data` | JSONB | `{ name, profile_url, avatar_url? }` |
| `created_at` | TIMESTAMPTZ (default now) | Record creation time |

### Unique Constraints
- `extraction_results` has a dedup check via `getExistingIds(workspaceId, fbIds[])` query — not a DB unique constraint, but application-level dedup per workspace

---

## State Transitions

```
                    ┌──────────┐
                    │  queued  │
                    └────┬─────┘
                         │ (job starts)
                         ▼
                    ┌──────────┐
          ┌────────│  running  │────────┐
          │         └────┬─────┘        │
          │              │              │
     (user stops)   (source exhausted   (system timeout
          │         or max reached)     / server restart)
          ▼              │              ▼
     ┌──────────┐  ┌──────────┐   ┌──────────┐
     │ canceled │  │ completed │   │  paused  │
     └──────────┘  └──────────┘   └────┬─────┘
                                   (resume) │
                                   ┌────────┘
                                   │
                                   ▼
                              ┌──────────┐
                              │  running  │
                              └──────────┘
          
          (auth failure / error)
               │
               ▼
          ┌──────────┐
          │  failed  │
          └──────────┘
```

### Key Changes to State Transitions

| Current Behavior | Fixed Behavior | Trigger |
|---|---|---|
| `running` → `completed` (overwrites `canceled`) | `running` → `canceled` (preserved) | User clicks Stop |
| `running` → `paused` (when maxResults reached) | `running` → `completed` (when maxResults reached) | Safety ceiling hit |
| `running` → `paused` (when shouldStop/time budget) | `running` → `paused` (unchanged) | System timeout — resumable |

### Status Semantics (Post-Fix)

| Status | Meaning | UI Label (AR/EN) | Color |
|---|---|---|---|
| `queued` | Waiting in queue | "في الانتظار" / "Queued" | Warning (amber) |
| `running` | Actively extracting | "قيد التشغيل" / "Running" | Primary (purple) |
| `completed` | Finished naturally — source exhausted or ceiling reached | "مكتملة" / "Completed" | Success (green) |
| `failed` | Error occurred — auth failure, network error | "فاشلة" / "Failed" | Error (red) |
| `paused` | System interruption — timeout, server restart. Resumable. | "متوقفة مؤقتاً" / "Paused" | Subtle (gray) |
| `canceled` | User intentionally stopped. Partial data preserved. | "موقوفة" / "Stopped" | Warning (amber) |

---

## Rate-Limiting Configuration

| Parameter | Current Value | New Value | Location |
|---|---|---|---|
| `requestDelayMs` | 600ms | 600ms (unchanged baseline) | `base.ts:203` |
| `batchSizeForRest` | 8 scrolls | 8 scrolls (unchanged) | `base.ts:204` |
| `restDelayMs` | 10,000ms | 10,000ms (unchanged) | `base.ts:205` |
| `backoffDelayMs` | N/A | 2,000ms (on rate-limit signal) | NEW: `base.ts` |
| `backoffDuration` | N/A | 5 scrolls (then return to normal) | NEW: `base.ts` |
| `maxRateLimitRetries` | N/A | 3 (then pause job) | NEW: `base.ts` |

---

## Validation Rules

### Group Member Name Filtering (NEW)

Applied in `group-members.ts` before adding to batch:

| Rule | Pattern | Example Excluded |
|---|---|---|
| Auto-generated names | `/^(Adventurous\|Playful\|Shiny\|Brave\|Clever\|Happy\|Jolly\|Mysterious\|Silly\|Friendly)\w+\d+/i` | "AdventurousRaccoon2824" |
| User + digits | `/^User\d{3,}$/i` | "User12345" |
| Business keywords | Name contains: "store", "shop", "news", "restaurant", "cafe", "school", "university", "bot" (case-insensitive) | "Hot Grill", "Nile University" |
| Too short | `name.length < 3` | "Ab" |
| WhatsApp placeholder | Name === "WA Not Available" | "WA Not Available" |
