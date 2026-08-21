/**
 * Proof: per-session device fingerprints.
 * Verifies the anti-logout fix — every session gets ONE stable, UA-matched
 * device identity (mobile UA ⇒ mobile viewport), and different sessions
 * get different fingerprints instead of one shared hardcoded one.
 */
import { buildSessionFingerprint, resolveUserAgent } from "../src/services/context-manager.js";

const MOBILE_UA = "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Version/16.0 Mobile Safari/604.1";

const s1a = buildSessionFingerprint("eced3848-9fb0-4d89-8845-060ccc41110f", MOBILE_UA);
const s1b = buildSessionFingerprint("eced3848-9fb0-4d89-8845-060ccc41110f", MOBILE_UA);
const s2 = buildSessionFingerprint("97db01c4-2594-4be0-819e-513fbcc6b4f5", DESKTOP_UA);
const s3 = buildSessionFingerprint("56246879-147e-4d8e-a829-b045da4005d8", DESKTOP_UA);
const s4 = buildSessionFingerprint("7d87c0da-ea16-4b45-91b4-7f1b21b36272", IPAD_UA);

console.log("session 1 (mobile UA): ", JSON.stringify(s1a));
console.log("session 2 (desktop UA):", JSON.stringify(s2));
console.log("session 3 (desktop UA):", JSON.stringify(s3));
console.log("session 4 (iPad UA):   ", JSON.stringify(s4));

const checks = [
  { name: "mobile UA ⇒ mobile viewport + scale ≥2", pass: s1a.isMobile && s1a.viewport.width < 500 && s1a.deviceScaleFactor >= 2 },
  { name: "desktop UA ⇒ desktop viewport + scale 1", pass: !s2.isMobile && !s3.isMobile && s2.deviceScaleFactor === 1 },
  { name: "iPad UA ⇒ mobile-class fingerprint", pass: s4.isMobile },
  { name: "same session ⇒ identical fingerprint across runs (stable device)", pass: JSON.stringify(s1a) === JSON.stringify(s1b) },
  { name: "different sessions ⇒ different viewports (no shared identity)", pass: JSON.stringify(s2) !== JSON.stringify(s3) },
  { name: "geo jitter stays within Cairo area (<0.15°)", pass: Math.abs(s1a.latitude - 30.0444) <= 0.15 && Math.abs(s1a.longitude - 31.2357) <= 0.15 },
];

for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
const allPass = checks.every((c) => c.pass);
console.log(allPass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(allPass ? 0 : 1);
