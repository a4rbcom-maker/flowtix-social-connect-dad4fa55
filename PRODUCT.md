# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are Arabic-speaking Facebook page owners, social media managers, and digital marketers who need to extract contact information from their pages at scale — specifically people who have sent messages to their Facebook pages (Messenger contacts), followers, commenters, post reactors, and group members.

Secondary users include agencies that manage multiple Facebook pages on behalf of clients, and enterprise marketing teams running data-driven campaigns on Facebook-sourced leads.

The product is also used by WhatsApp power users who want automation, bulk messaging, AI agents, and campaign management on top of WhatsApp Business.

A small portion of users are platform administrators who manage subscriptions, users, plans, and security from the admin dashboard.

## Product Purpose

FlowTix is a SaaS platform that turns Facebook pages and WhatsApp accounts into structured, exportable, and actionable data sources.

On the Facebook side, the product extracts:
- People who messaged a page (Messenger contacts) with the goal of producing lead lists from organic page conversations.
- Page followers, post commenters, and post reactors for audience analysis.
- Group members for community management and outreach.

On the WhatsApp side, the product provides session management, bulk messaging campaigns, an AI agent that can converse with contacts, automation workflows, and analytics.

The product then lets users export the extracted data in common formats (CSV, JSON, Excel) and broadcast messages back to those contacts via Messenger or WhatsApp.

Success means: a user can connect a Facebook page in under a minute, extract a list of every person who has messaged that page, and re-export or re-message them, without manually scrolling or copy-pasting from the Facebook UI.

## Positioning

FlowTix operates by injecting the user's real Facebook session cookies into a Playwright-controlled Chromium browser, navigating to the page's Meta Business Suite Inbox and other Facebook surfaces, intercepting the GraphQL responses that contain conversation participants, deep-recursively parsing them to extract contact IDs and names, and writing the results to the user's own database.

The mechanism — automated session replay through the user's own logged-in browser — is what differentiates this product from platforms that require Facebook API access tokens or Business Manager permissions. The user only has to be logged into Facebook; no API key, no app review, no business verification.

On the WhatsApp side, the product uses the Baileys open-source WhatsApp Web library to drive sessions from the user's own WhatsApp credentials.

## Operating Context

Users open the app from a desktop browser, primarily in an Arabic (RTL) interface with English available as a secondary locale. They work session by session: pick a connected Facebook or WhatsApp session, pick a target page or group, set extraction options, start the job, watch progress, then export or broadcast.

Each extraction runs in a headless Chromium browser managed by a separate Node.js extraction service. Jobs are queued through a single-threaded queue with a configurable timeout (currently 600 seconds). The browser pool currently runs one browser; one job runs at a time. The UI subscribes to Supabase Realtime updates so progress is visible without polling.

Session cookies are encrypted at rest in Supabase. The product is multi-tenant — workspaces group a user's pages and sessions together.

## Capabilities and Constraints

**Confirmed capabilities:**
- Facebook session management (connect, test, rename, archive, delete) with live auth checks.
- List managed Facebook pages for a session.
- Extract Messenger contacts (people who messaged a page), page followers, post comments, post reactions, and group members.
- Cursor-based pagination for multi-page extraction, deduping against already-persisted contacts.
- Export results in CSV and JSON from the extraction service directly.
- WhatsApp session lifecycle via Baileys (QR-based connection, status transitions, telemetry).
- WhatsApp bulk messaging campaigns with configurable rate limits.
- WhatsApp AI agent that converses with contacts.
- Subscription and plan management via Stripe-style webhooks (subscriptions table).
- Admin panel for managing users, plans, subscriptions, audit logs, AI providers, security, and notifications.
- Real-time UI updates via Supabase Realtime channels on extraction_jobs and fb_sessions tables.

**Confirmed technical constraints:**
- Single Chromium browser per service instance, single concurrent extraction job.
- 600-second default job timeout.
- One Facebook session per page is currently typical (cookies are tied to a profile).
- The user must keep their Facebook session active (not logged out); the product does not bypass Facebook's session cookies or 2FA.
- The product's messenger contact extraction depends on the page being connected to Meta Business Suite and having access to the inbox API.
- WhatsApp campaigns are rate-limited per WhatsApp's anti-ban policies.

**Explicitly undecided product facts (do not invent):**
- Pricing tiers and per-tier limits are not specified here.
- Whether the platform supports personal Facebook profiles (vs only Facebook Pages) is not confirmed.
- Specific regional availability or compliance posture is not confirmed.

## Brand Commitments

- Brand name: **FlowTix** (registered domain: flowtix.app).
- Author / owner: Khaled Abdelrahman.
- Primary interface language: **Arabic**, right-to-left. English is a secondary locale.
- The product must always feel professional, calm, and trustworthy — it handles real business data and real customer outreach, so unprofessional tone or visual chaos would damage trust.
- The product never impersonates the user or fabricates testimonials, case studies, or benchmark numbers.
- WhatsApp session credentials and Facebook session cookies are treated as sensitive — the product encrypts them at rest and never logs them.

## Evidence on Hand

- Existing web app at flowtix.app running in production for the author.
- Existing admin dashboard with live user/subscription/security monitoring.
- Existing extraction service handling real extraction jobs for the author and a small test user base.
- AGENTS.md (4468 lines) is the canonical engineering constitution for the project — it documents the entire product and engineering scope from rule definitions.
- spec/001-messenger-full-extraction/ contains the full specification for the messenger-contact extraction feature, including research, data model, contracts, quickstart, and implementation tasks.

**Things future design work must NOT fabricate:**
- Customer logos, testimonials, or case studies that don't exist.
- Pricing numbers or plan limits that haven't been published.
- Claimed performance benchmarks that haven't been measured.
- Screenshots of dashboards or metrics that aren't real.

## Product Principles

1. **Real data, not proxies.** When the product claims to extract contacts, the data must be people who actually messaged the page — never placeholders, demos, or "approximately this many".
2. **The user's own session is the source of truth.** The product amplifies what the user can already see in their Facebook and WhatsApp clients; it never invents data, never spoofs endpoints, never bypasses 2FA.
3. **Visible progress, visible stop reasons.** Long-running jobs must show live progress and must log a clear, human-readable reason for every stop, including partial results and errors.
4. **RTL-first, Arabic-first.** The interface is read primarily in Arabic; layouts, typography, and iconography must work in RTL from the start.
5. **Exportable and re-importable.** Every piece of data the user can see must be exportable. The user owns their data; nothing is locked-in.
6. **Treat sessions as sensitive.** Facebook cookies and WhatsApp sessions are secrets — never log them, never display them, never expose them.

## Accessibility & Inclusion

The product is bilingual (Arabic and English) and RTL-aware by default. Color contrast and focus states follow the existing design tokens (`--color-*` CSS variables). All interactive elements must be keyboard-reachable, screen-reader-friendly, and operable without a mouse. The interface must remain usable at common zoom levels and on common screen sizes (desktop primary, mobile acceptable).
