# Data Model: Messenger Full Extraction

**Feature**: Messenger Full Extraction  
**Date**: 2026-07-29

---

## Entity: Extraction Job

Table: `extraction_jobs` (existing)

### Existing Columns (Unchanged)

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` | Primary key |
| `user_id` | `string` | Owner UUID |
| `type` | `extraction_type` enum | Always `messenger_contacts` for this feature |
| `status` | `job_status` enum | `queued` → `running` → `completed` / `failed` / `partial` / `canceled` |
| `source` | `string` | Page identifier (e.g., `"manfaz.alnasr"`) |
| `error` | `string` | Error message or stop reason (e.g., `"session expired at 500 contacts"`) |
| `result_count` | `integer` | Number of contacts extracted |
| `started_at` | `timestamptz` | Job start timestamp |
| `completed_at` | `timestamptz` | Job end timestamp |
| `created_at` | `timestamptz` | Row creation |
| `config` | `json` | Job configuration (includes `maxResults` if user-specified) |

### New Column

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `progress` | `json` | `{}` | Real-time progress data (see Progress JSON schema below) |

### Progress JSON Schema

```json
{
  "discovered": 1400,
  "processed": 1350,
  "duplicates_skipped": 0,
  "estimate": 75,
  "phase": "paginating",
  "phase_cycle": 8,
  "last_page_cursor": "AQHS4K8uXZcm...",
  "last_update": "2026-07-29T18:00:00Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `discovered` | `number` | Total unique contact IDs seen |
| `processed` | `number` | Contacts saved to database |
| `duplicates_skipped` | `number` | Contacts already in DB (skipped) |
| `estimate` | `number \| "ongoing"` | Completion percentage (0-100) or `"ongoing"` if still paginating |
| `phase` | `string` | Current phase: `"initializing"`, `"paginating"`, `"scrolling"`, `"mbasic_fallback"`, `"finishing"` |
| `phase_cycle` | `number` | Iteration count within current phase |
| `last_page_cursor` | `string` | Last pagination cursor used |
| `last_update` | `ISO 8601` | Timestamp of last progress update |

### State Transitions

```
[created] → queued
queued → running
running → completed     (end of list reached, 3 empty cycles)
running → partial       (job timeout, OR user maxResults reached)
running → failed        (auth failure / unexpected error)
running → canceled      (user cancellation, shouldStop flag)
```

### Validation Rules

- `status` = `completed` ONLY when the extraction genuinely exhausted all pages (3 empty cycles).
- `status` = `partial` when timeout or user-configured limit stops the job before exhaustion.
- `status` = `failed` when an error (session expiry, page ban, unexpected exception) causes the stop.
- `error` must contain a human-readable stop reason whenever `status` ≠ `completed`.

---

## Entity: Extraction Result

Table: `extraction_results` (existing, unchanged)

### Existing Columns

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` | Primary key |
| `job_id` | `string` | FK → `extraction_jobs.id` |
| `workspace_id` | `string` (nullable) | Workspace scope |
| `fb_id` | `string` | Facebook user ID |
| `fb_type` | `string` | Always `"user"` for messenger contacts |
| `data` | `json` | `{ name, profile_url, avatar_url }` |
| `metadata` | `json` | Additional metadata (`{}` by default) |
| `created_at` | `timestamptz` | Row creation |

### Data JSON Schema (per contact)

```json
{
  "name": "Ahmed Mohamed",
  "profile_url": "https://www.facebook.com/ahmed.mohamed",
  "avatar_url": "https://scontent.fcai21-4.fna.fbcdn.net/v/.../photo.jpg"
}
```

---

## Entity: Extracted Contact (In-Memory, Temporary)

Used within `messenger-contacts.ts` during extraction. Not persisted directly.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Facebook user ID (number string, 8–20 digits) |
| `name` | `string` | Display name |
| `avatarUrl` | `string` (nullable) | Profile picture URL |
| `profileUrl` | `string` | FB profile URL (constructed) |

### Deduplication

Keyed by `id` (Facebook user ID). The `seen` set tracks IDs already persisted in this job. The `dbExisting` set tracks IDs from prior extractions (loaded from `extraction_results` via `getExistingIds`).

---

## Entity: Pagination Cursor

Used during the cursor-pagination loop. Not persisted.

| Field | Type | Description |
|-------|------|-------------|
| `cursor` | `string` | Opaque cursor token from `extractCursor(response)` |
| `prevCursor` | `string` | Previous cursor value (to detect stall) |
| `url` | `string` | GraphQL endpoint URL (`/api/graphql/`) |
| `docId` | `string` | GraphQL document ID (e.g., `"27615938851434506"`) |
| `variablePattern` | `Record<string, any>` | Variables payload that successfully returned contacts |
