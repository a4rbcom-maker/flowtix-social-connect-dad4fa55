import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from "playwright";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";

const log = logger;

chromium.use(StealthPlugin());

const FINGERPRINTS = [
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "ar-EG",
    timezoneId: "Africa/Cairo",
    secChUa: '"Chromium";v="131", "Not_A Brand";v="99", "Google Chrome";v="131"',
    platform: '"Windows"',
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    secChUa: '"Chromium";v="130", "Not_A Brand";v="99", "Google Chrome";v="130"',
    platform: '"Windows"',
  },
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "ar-AE",
    timezoneId: "Asia/Dubai",
    secChUa: '"Chromium";v="131", "Not_A Brand";v="99", "Google Chrome";v="131"',
    platform: '"macOS"',
  },
];

let fingerprintIdx = 0;

export function getNextFingerprint() {
  const fp = FINGERPRINTS[fingerprintIdx % FINGERPRINTS.length];
  fingerprintIdx++;
  return fp;
}

export async function launchStealthBrowser(): Promise<Browser> {
  try {
    const browser = await chromium.launch({
      headless: config.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-infobars",
        "--window-size=1366,768",
        "--disable-extensions",
        "--disable-default-apps",
        "--no-first-run",
        "--disable-popup-blocking",
      ],
    });
    log.info("BrowserSetup", "stealth browser launched with anti-detection patches");
    return browser;
  } catch (err) {
    log.error("BrowserSetup", `failed to launch stealth browser: ${String(err)}`);
    throw new ExtractionError(ErrorCodes.BROWSER_CRASH, `Stealth browser launch failed: ${String(err)}`);
  }
}

export function buildStealthContextOptions(fp: ReturnType<typeof getNextFingerprint>) {
  return {
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    permissions: ["geolocation"],
    geolocation: { latitude: 30.0444, longitude: 31.2357 },
    extraHTTPHeaders: {
      "Accept-Language": `${fp.locale},${fp.locale.split("-")[0]};q=0.9,en-US;q=0.8,en;q=0.7`,
      "sec-ch-ua": fp.secChUa,
      "sec-ch-ua-platform": fp.platform,
      "sec-ch-ua-mobile": "?0",
    },
  };
}

export { FINGERPRINTS };
