// Source of truth for Facebook integration constants used across UI + hooks.
export const REQUIRED_SCOPES = [
  "public_profile",
  "email",
  "user_groups",
  "groups_access_member_info",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
] as const;

export type RequiredScope = (typeof REQUIRED_SCOPES)[number];

export const EXPIRY_WARN_DAYS = 7;
export const GRAPH_EXPLORER_URL = "https://developers.facebook.com/tools/explorer/";
export const FB_LOGIN_URL = "https://www.facebook.com/login";

// Single global cap on any server-fn round-trip from the Facebook page so
// the UI never appears to "hang" when the network or Graph API stalls.
export const FB_CALL_TIMEOUT_MS = 15_000;
