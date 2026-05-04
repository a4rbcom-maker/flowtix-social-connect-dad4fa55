## Goal
Add inline quick-action buttons inside the Facebook and WhatsApp sidebar groups so the user can connect or disconnect each channel without opening any subpage.

## Behavior

When a sidebar channel group (Facebook / WhatsApp) is expanded, render a small action row right under the group's child links:

- **Disconnected** → single primary button: **"ربط الحساب" / "Connect"**
  - Facebook: navigates to `/dashboard/facebook` (token paste flow lives there — we can't generate a token from the sidebar).
  - WhatsApp: navigates to `/dashboard/whatsapp` (bot setup page).
- **Connected / Expiring** → two buttons side-by-side:
  - **"تحديث" / "Refresh"** — re-runs the status probe (calls `useChannelStatus.refresh()`); shows a spinner for ~1s.
  - **"فصل" / "Disconnect"** — opens a small confirm popover, then calls the disconnect flow.
- **Expired** → single amber button: **"إعادة الربط" / "Reconnect"** → routes to the channel page.
- **Loading** → disabled skeleton button.

When the sidebar is **collapsed** (icon-only), no buttons render — clicking the channel icon still expands the group to reveal them, matching current group-expand behavior.

## Disconnect flow

- **Facebook**: call `disconnectFacebook` server fn through `useFacebookApi().call(...)`. On success: toast "تم فصل فيسبوك" / "Facebook disconnected", then `refresh()` the channel status. On failure: toast `describeFbError(err, lang)`.
- **WhatsApp**: `supabase.from("whatsapp_settings").update({ is_connected: false, last_connected_at: null }).eq("user_id", user.id)`. On success/failure: same toast + refresh pattern.

Confirm step is a tiny inline popover (custom, no new shadcn install) with two buttons "تأكيد / إلغاء" — avoids the destructive-by-mistake risk.

## Files to add / edit

1. **NEW** `src/components/dashboard/ChannelQuickActions.tsx`
   - Props: `{ channel: "facebook" | "whatsapp", state: ChannelState, lang: "ar"|"en", onChanged: () => void }`
   - Owns: pending state, confirm-popover state, disconnect calls, navigation links.
   - Uses `useFacebookApi` for FB, `supabase` client for WA.
   - Bilingual strings inline (matches the layout's existing pattern).

2. **EDIT** `src/components/dashboard/DashboardLayout.tsx`
   - Inside the group's expanded `<div>` (right after the children list, lines ~270-290), render `<ChannelQuickActions channel={item.key} state={channelState} lang={lang} onChanged={channelStatus.refresh} />` for Facebook and WhatsApp groups.
   - Pass `channelStatus.refresh` (already returned by the hook — verified) so the dot updates immediately after a connect/disconnect.

3. **No changes** to `useChannelStatus`, server functions, or routes — all existing APIs are sufficient.

## Visual spec

- Action row sits inside the indented child container (same `mr-5/ml-5` border guide as the children) with a top divider for separation.
- Buttons: `h-7`, rounded-lg, `text-[12px]`, full-width split when two are shown.
  - Connect/Reconnect: primary gradient (matches existing primary-to-violet gradient in the layout).
  - Disconnect: ghost destructive (`text-destructive hover:bg-destructive/10`).
  - Refresh: ghost neutral with `RefreshCw` icon that spins while pending.
- Confirm popover: small card absolutely positioned above the row, `shadow-lg`, two buttons.

## Out of scope

- No Graph API token-generation UI in the sidebar (security + UX — token paste stays on the FB page).
- No WhatsApp QR/pairing UI in the sidebar (stays on WA page).
- No new translations file — follow the existing inline `lang === "ar" ? ... : ...` pattern used throughout the layout.
