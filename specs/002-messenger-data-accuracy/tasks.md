# Tasks: دقة بيانات جهات ماسنجر

**Input**: Design documents from `/specs/002-messenger-data-accuracy/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Tests**: Manual verification via `quickstart.md` scenarios — no test framework.

**Organization**: Tasks grouped by functional requirement. All changes are in ONE file.

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different sections of the same file)
- **[Story]**: Maps to functional requirement (FR1, FR2, ... FR6)
- All paths relative to `extraction-service/src/extractors/messenger-contacts.ts`

---

## Phase 1: Setup — إضافة كاونترات و Constants

**Purpose**: إضافة متغيرات التتبع للفلترة الجديدة

- [x] T001 Add counters at top of `extract()` method in `extraction-service/src/extractors/messenger-contacts.ts` — declare: `let skippedResponses = 0`, `let messengerResponses = 0`, `let excludedPages = 0`, `let excludedBots = 0`, `let excludedAutoGen = 0`, `let duplicatesPrevented = 0`

**Checkpoint**: الكاونترات جاهزة

---

## Phase 2: FR-1 — Messenger-Only Response Filtering 🎯 MVP

**Goal**: `deepParse` لا تستدعي إلا على GraphQL responses الخاصة بـ Messenger فقط.

**Independent Test**: تشغيل استخراج صغير — الـ log يظهر skippedResponses > 0 (تم تخطي responses) و messengerResponses > 0 (تم استخراج من responses فقط).

- [x] T002 [FR1] Add `isMessengerResponse(text, postData)` function in `extraction-service/src/extractors/messenger-contacts.ts`:
  - Return `true` if postData contains `"thread"` or `"inbox"` or `"message_thread"`
  - Return `true` if response text contains `"retrieve_biz_crm_contact"` AND `"shared_attributes"`
  - Return `true` if response text contains `"thread_key"` or `"last_message"`
  - Return `false` if response text contains `"timeline_list_feed_units"` or `"profile_for_intent_switching"` (hard block)
  - Otherwise, return `false` (unknown/unrelated response)
- [x] T003 [FR1] Modify `handleResponse` callback in `extraction-service/src/extractors/messenger-contacts.ts` — wrap `deepParse` call with `isMessengerResponse` check:
  - Before `deepParse`: if `!isMessengerResponse(text, postData)`, increment `skippedResponses` and skip
  - Log every 20th skipped response: `"[graphql #N] SKIPPED (timeline/profile/non-messenger)"`
  - When calling `deepParse`, increment `messengerResponses`

**Checkpoint**: فقط Messenger responses يتم استخراجها. الـ log يظهر skipped count.

---

## Phase 3: FR-2, FR-3, FR-4 — تحسين walkJSON للفلترة

**Goal**: داخل `walkJSON` نفسها، نضيف 3 طبقات فلترة إضافية.

**Independent Test**: استخراج صغير — النتائج لا تحتوي على صفحات، مؤسسات، أو أسماء مولّدة.

### FR-2: Self-Reference Exclusion

- [x] T004 [FR2] Add page name exclusion in `walkJSON` in `extraction-service/src/extractors/messenger-contacts.ts`:
  - Compare `obj.name` against a known page name (extracted from page profile early in the run)
  - If `obj.name` equals the page display name, skip this contact

### FR-3: Typename + Keyword Filtering

- [x] T005 [P] [FR3] Enhance `__typename` filter in `walkJSON` in `extraction-service/src/extractors/messenger-contacts.ts` — add ALL missing non-user types: `"Business"`, `"Organization"`, `"Store"`, `"Group"`, `"Event"`, `"Application"`, `"Game"`, `"AIAssistant"`, `"Bot"`, `"App"`
- [x] T006 [P] [FR3] Add name-based keyword exclusion in `walkJSON` in `extraction-service/src/extractors/messenger-contacts.ts`:
  - Define a `Set<string>` of excluded keywords: `"news"`, `"store"`, `"school"`, `"university"`, `"restaurant"`, `"cafe"`, `"airline"`, `"entertainment"`, `"recruiting"`, `"foundation"`, `"magazine"`, `"institution"`, `"agency"`, `"consulting"`, `"shipping"`, `"wedding"`, `"nursery"`, `"academy"`, `"journal"`
  - If object name contains any of these keywords AND `__typename` is not `"User"`, exclude the contact
  - Increment `excludedPages` for each exclusion

### FR-4: Auto-Generated Name Exclusion

- [x] T007 [P] [FR4] Add auto-generated name pattern check in `walkJSON` in `extraction-service/src/extractors/messenger-contacts.ts`:
  - Pattern: `/^(Adventurous|Playful|Shiny|Happy|Sleepy|Crazy|Funny|Silly|Cool|Super)[A-Z][a-z]+\d+$/`
  - If name matches, exclude and increment `excludedAutoGen`
  - Also exclude `"WA Not Available"` and names starting with `"IG "` (Instagram placeholder)

**Checkpoint**: الـ 3 طبقات فلترة تم تطبيقها داخل `walkJSON`. النتائج أصبحت أنظف بشكل ملحوظ.

---

## Phase 4: FR-5 — تحسين الـ Deduplication

**Goal**: ممنوع تكرار الشخص — بنفس الـ ID أو بنفس الاسم.

**Independent Test**: تشغيل نفس الاستخراج مرتين — مفيش تكرار في الـ IDs أو الأسماء.

- [x] T008 [P] [FR5] Add name-based dedup `Map<string, Set<string>>` in `extract()` method in `extraction-service/src/extractors/messenger-contacts.ts`:
  - Key: lowercase normalized name
  - Value: Set of IDs that share this name
  - Before adding a contact, check if the name already exists with a different ID
  - If yes, increment `duplicatesPrevented` and keep the personal ID (not page ID)
- [x] T009 [FR5] Add page name exclusion at extract level in `extract()` method in `extraction-service/src/extractors/messenger-contacts.ts`:
  - Store `pageName` alongside `pageId` during the initial page profile extraction
  - Filter out any contact whose name exactly matches `pageName`

**Checkpoint**: Zero duplicate names/IDs في النتائج.

---

## Phase 5: FR-6 — Audit Logging

**Goal**: كل Exclusion لازم يكون مسجل في الـ log.

**Independent Test**: الـ log النهائي للمهمة فيه breakdown كامل.

- [x] T010 [FR6] Add final audit log entry at the end of `extract()` in `extraction-service/src/extractors/messenger-contacts.ts`:
  - Format: `"=== AUDIT: total=X, messengerResponses=Y, skippedResponses=Z, excludedPages=W, excludedBots=V, excludedAutoGen=U, duplicatesPrevented=T"`
  - Add after the existing `=== DONE ===` log entry
- [x] T011 [P] [FR6] Log each `handleResponse` skip with reason in `extraction-service/src/extractors/messenger-contacts.ts`:
  - Every 20th skipped response → log with docId and reason
  - Format: `"[graphql #N] SKIPPED: {reason} doc_id={docId}"`

**Checkpoint**: الـ audit trail كامل.

---

## Phase 6: Polish — Validation

**Purpose**: Typecheck + تشغيل سيناريوهات quickstart.md

- [x] T012 Run quickstart scenarios from `specs/002-messenger-data-accuracy/quickstart.md`:
  - Scenario 1: بدون صفحات
  - Scenario 2: بدون أسماء مولّدة
  - Scenario 3: بدون تكرار (صفحة نفسها)
  - Scenario 4: دقة إجمالية ≥ 90%
  - Scenario 5: استقرار (±5% بين تشغيلين)
- [x] T013 Typecheck: `cd extraction-service && npx tsc --noEmit`

**Checkpoint**: Validation complete, ready for production.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: No dependencies
- **Phase 2**: Depends on Phase 1 (T001 counters)
- **Phase 3**: Depends on Phase 2 (needs T002-T003 in place)
- **Phase 4**: Depends on Phase 3 (dedup uses the same walkJSON/contacts flow)
- **Phase 5**: Depends on Phase 1 (counters) + Phase 2-4 (actual exclusions)
- **Phase 6**: Depends on all previous phases

### Within Each Phase

- T002 before T003 (function before usage)
- T004-T007 are all in the same walkJSON function — implement in order but they're in the same edit block
- T008 before T009 (T009 is simpler and can go last)

### Parallel Opportunities

| Group | Tasks | Reason |
|-------|-------|--------|
| Phase 3 | T005, T006, T007 | Different filter types in same function but independent logic |
| Phase 5 | T010, T011 | Both log entries in extract(), independent of each other |

---

## Implementation Strategy

### MVP First (Phase 1-2)

Complete T001-T003 (4 tasks):
- ✅ Add counters
- ✅ Add `isMessengerResponse` function
- ✅ Modify handleResponse to filter responses

This alone cuts 30% of false positives by skipping non-Messenger responses entirely.

### Incremental Delivery

1. Phase 1-2 (MVP): Response filtering → Test with quickstart Scenario 1
2. Phase 3 (FR2-4): Enhanced walkJSON filtering → Test with Scenarios 2-3
3. Phase 4 (FR5): Dedup → Test with Scenario 5
4. Phase 5 (FR6): Audit logging → Test with Scenario 4
5. Phase 6: Full validation → All 5 scenarios pass

### Single Developer Strategy

Total: 13 tasks. Estimated effort: **1-2 hours**.

1. 30 mins: Phase 1-2 (T001-T003)
2. 30 mins: Phase 3 (T004-T007) — biggest block, all in walkJSON
3. 15 mins: Phase 4 (T008-T009)
4. 15 mins: Phase 5 (T010-T011)
5. 15 mins: Phase 6 (T012-T013)

---

## Notes

- **كل التغيير في ملف واحد**: `extraction-service/src/extractors/messenger-contacts.ts`
- **الـ walkJSON والدالة isMessengerResponse** — الأساس العامل
- **الـ keyword list** — قابلة للتوسيع مستقبلاً
- **لا توجد API endpoints جديدة** — التغييرات داخلية بالكامل
- **الـ auto-generated name pattern** — قابل للتوسيع عند اكتشاف أنماط جديدة
