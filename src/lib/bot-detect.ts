// Server-side bot / crawler / preview detection.
// Used to exclude non-human traffic from analytics.

const BOT_UA_REGEX = new RegExp(
  [
    // Generic
    "bot", "crawl", "spider", "slurp", "fetch", "monitor", "scanner", "probe",
    "headless", "phantom", "selenium", "playwright", "puppeteer", "cypress",
    "python-requests", "curl", "wget", "httpclient", "okhttp", "axios", "go-http",
    "java/", "libwww", "postmanruntime", "insomnia",
    // Search engines
    "googlebot", "bingbot", "yandex", "duckduckbot", "baiduspider", "sogou",
    "ahrefsbot", "semrushbot", "mj12bot", "dotbot", "petalbot", "seznam",
    "applebot", "amazonbot", "gptbot", "ccbot", "claudebot", "perplexitybot",
    "chatgpt", "bytespider", "coccocbot", "sitebot", "adsbot",
    // Social preview / link unfurlers
    "facebookexternalhit", "facebot", "twitterbot", "linkedinbot", "slackbot",
    "discordbot", "telegrambot", "whatsapp", "skypeuripreview", "vkshare",
    "pinterest", "redditbot", "embedly", "quora link preview", "outbrain",
    // Uptime/SEO tools
    "uptimerobot", "pingdom", "statuscake", "gtmetrix", "lighthouse", "pagespeed",
    "chrome-lighthouse", "dareboost", "webpagetest",
  ].join("|"),
  "i",
);

export type BotCheck = { isBot: boolean; reason: string | null };

export function detectBot(userAgent: string | null | undefined): BotCheck {
  if (!userAgent || userAgent.trim().length < 5) {
    return { isBot: true, reason: "empty_or_short_ua" };
  }
  const m = BOT_UA_REGEX.exec(userAgent);
  if (m) return { isBot: true, reason: `ua_match:${m[0].toLowerCase()}` };
  // Very old/simple UAs used only by scripts
  if (/^Mozilla\/(3|4)\.0$/i.test(userAgent.trim())) {
    return { isBot: true, reason: "legacy_ua" };
  }
  return { isBot: false, reason: null };
}
