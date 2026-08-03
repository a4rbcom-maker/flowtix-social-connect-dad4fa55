# Specification: Messenger Data Accuracy

**Feature**: Messenger Data Accuracy
**Status**: Draft
**Created**: 2026-07-29
**Owner**: Engineering Team

---

## Problem Statement

The Messenger contacts extraction returns data that is inaccurate and misleading. Instead of returning only real people who have sent messages to the page, the system returns a mix of:

1. **Page names and media outlets** — "Egypt Today Magazine", "mbc.net", "القاهرة 24", "FilGoal.com"
2. **Stores and restaurants** — "Noha store", "Hot Grill", "Mr.Crunchy chicken"
3. **Institutions** — "Nile University", "مدرسة جمال عبد الناصر", "مؤسسة منار الإسلام"
4. **Random generated names** — "AdventurousRaccoon2824", "ShinyCapybara5881"
5. **Bot names** — "اكسترا بوت", "WA Not Available"
6. **The page itself** — "منفذ النصر" appears in the extraction results
7. **The admin** — "خالد عبدالرحمن" appears twice with different IDs
8. **Names the user does not recognize** — people who never sent messages but appeared because their profiles were referenced in other GraphQL responses

**Root Cause Identified**: The `walkJSON` function recursively parses ALL intercepted GraphQL responses, not just Messenger conversation responses. It finds ANY object with a numeric `id` and a `name` string — including timeline post authors, page profile data, suggested pages, CRM contact references, and auto-generated names from placeholder accounts. This means contacts are extracted from responses that have nothing to do with messenger conversations.

The existing `__typename` filtering partially addresses this but doesn't solve the core problem: the system shouldn't be parsing non-Messenger responses at all.

---

## Goal

Extraction results that contain ONLY people who have actually sent messages to the page. Zero pages, zero bots, zero institutions, zero auto-generated names, zero self-references.

When the user compares the extracted list against their actual Messenger inbox, every name should match a real conversation they can find in their inbox.

---

## User Scenarios & Testing

### Primary Scenario: Verified Contact Match
**Actor**: Page admin
**Flow**:
1. Admin runs messenger contact extraction
2. System extracts 200 contacts
3. Admin opens their Meta Business Suite Inbox
4. Admin compares each extracted name against their actual conversation list
5. All extracted names match an actual conversation participant
6. Zero false positives

### Page Admin Self-Reference
**Actor**: Page admin
**Flow**:
1. Admin runs messenger contact extraction
2. Admin is also a personal user who messages the page
3. The admin's personal profile appears once (not the page itself)
4. The page name ("منفذ النصر") does NOT appear in the results
5. The page profile does NOT appear in the results

### Duplicate Page Profile
**Actor**: Page admin
**Flow**:
1. Admin runs messenger contact extraction
2. No contact appears twice with different IDs
3. Each person appears exactly once

### Re-Extraction Consistency
**Actor**: Page admin
**Flow**:
1. Admin runs the same extraction twice in a row
2. Both extractions yield the same set of actual contacts (±5% for pagination variance)
3. The admin recognizes all names from their inbox

---

## Functional Requirements

### FR-1: Messenger-Only Response Filtering
The system must ONLY extract contacts from GraphQL responses that are specifically about Messenger conversations.

**Acceptance Criteria**:
- The `handleResponse` callback must check if the GraphQL response is a Messenger conversation response before calling `deepParse`
- A response is considered "Messenger" if AT LEAST ONE of: `postData` contains "thread" / "message_thread" / "inbox", OR response text contains "retrieve_biz_crm_contact", OR response text contains "participants" combined with "thread"
- Responses that are clearly NOT Messenger (timeline feed, profile switching, friend suggestions, page insights) must be skipped entirely
- At least 95% of extracted contacts must be verifiable as messenger conversation participants

### FR-2: Self-Reference and Page Exclusion
The system must never include the page itself or its admin profile in the extraction results.

**Acceptance Criteria**:
- The page ID (`pageId`) must be excluded from results — both as a contact and as a reference in any response
- Any contact whose `id` matches `pageId` or whose name matches the page name must be excluded
- The page admin's personal profile must only appear if they actually messaged the page as a personal user (not as the page)

### FR-3: Page/Business/Institution Filtering
The system must exclude pages, businesses, stores, institutions, and organizations from the results.

**Acceptance Criteria**:
- Any contact with `__typename = "Page"`, `"Business"`, `"Organization"`, `"Store"`, `"Group"`, `"Event"`, `"Application"` must be excluded
- Any contact with `__isMessagingActor` containing "page", "bot", or "business" must be excluded
- Names containing keywords like "News", "Store", "School", "University", "Restaurant", "Cafe", "Airline", "Entertainment", "Recruiting", "Champions" combined with "Team/Members" must be flagged and excluded if their `__typename` is not "User"
- At least 99% of results must be personal user accounts (not pages)

### FR-4: Auto-Generated Name Exclusion
The system must exclude profiles with auto-generated or placeholder names.

**Acceptance Criteria**:
- Names matching patterns like "Adventurous[Rr]accoon", "Playful\w+", "Shiny\w+", "Capybara" (Facebook auto-generated names for placeholder accounts) must be excluded
- Names containing "User" followed by digits must be excluded
- Names that are less than 3 characters or contain only special characters must be excluded
- "WA Not Available" entries (WhatsApp placeholder) must be excluded

### FR-5: Deduplication by User ID
The system must never return the same person twice.

**Acceptance Criteria**:
- Each person is identified by their unique Facebook user ID
- If the same person appears with multiple IDs (e.g., page admin appears as both page ID and personal ID), the personal ID takes precedence and the page ID is excluded
- The final result set has 0 duplicate user IDs
- The final result set has 0 duplicate names

### FR-6: Verifiable Output
The output must be auditable — the system should log why each contact was included.

**Acceptance Criteria**:
- The final log entry includes a breakdown: total extracted, pages excluded, bots excluded, auto-generated excluded, duplicates removed
- Each GraphQL response is logged with its `doc_id` and whether it was treated as "Messenger" or "Skipped"

---

## Success Criteria

| # | Criterion | Measurement |
|---|-----------|-------------|
| SC-1 | **True positive rate** | ≥ 90% of extracted contacts are verified as conversation participants by manual inbox inspection |
| SC-2 | **Zero self-reference** | The page name/profile never appears in results |
| SC-3 | **Zero duplicate names** | No person appears more than once (by name and by ID) |
| SC-4 | **Zero auto-generated names** | No "AdventurousRaccoon", "PlayfulGuava", "ShinyCapybara", etc. |
| SC-5 | **Zero pages** | No "__typename: Page", no news outlets, no stores, no restaurants |
| SC-6 | **Consistency** | Two consecutive runs of the same page yield within ±5% of the same contact count |
| SC-7 | **Auditability** | Final log shows: `total=X, messengerResponses=Y, skippedResponses=Z, excludedPages=W, excludedBots=V, duplicatesRemoved=U` |

---

## Key Entities

| Entity | Description |
|--------|-------------|
| **GraphQL Response** | An intercepted response from facebook.com/graphql or api/graphql. Each response has a doc_id, postData, and response text. |
| **Messenger Response** | A GraphQL response that contains conversation/thread data. Identified by postData keywords or response text structure. |
| **Extracted Contact** | A person extracted from the system. Has: fb_id (numeric), name (string), avatar_url (optional). |
| **Verified Contact** | An extracted contact whose conversation can be found in the Meta Business Suite Inbox. |
| **Auto-Generated Name** | Facebook placeholder names like "AdventurousRaccoon2824", "ShinyCapybara5881", "PlayfulGuava970". |

---

## Assumptions

1. The Meta Business Suite Inbox is the authoritative source for "people who messaged the page" — any name not found there is a false positive.
2. Facebook's GraphQL response structure uses `__typename`: "User" for personal accounts and "Page" for pages.
3. The conversation-list GraphQL response (doc_id=27615938851434506) and the scroll-triggered responses (doc_id=26925765647096353) are the ONLY legitimate sources of messenger contacts.
4. All other GraphQL responses triggered during page navigation (timeline, profile switching, friend suggestions, page insights) should be SKIPPED for contact extraction.

---

## Dependencies

- **`extraction-service/src/extractors/messenger-contacts.ts`**: The `handleResponse` callback and `walkJSON` function
- **`specs/001-messenger-full-extraction/`**: Previous feature specification that introduced the extraction pipeline

---

## Out of Scope

- Changing the WhatsApp extraction pipeline
- Modifying the frontend UI
- Changing job scheduling or timeout behavior
- Adding new API endpoints