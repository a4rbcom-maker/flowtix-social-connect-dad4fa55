import type { Page } from "playwright";
import { logger } from "../logger.js";

const log = logger;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export interface ProfileData {
  fb_id: string;
  name: string;
  profile_url: string;
  /** extracted from profile page */
  bio?: string;
  location?: string;
  workplace?: string;
  education?: string;
  relationship?: string;
  birthday?: string;
  follower_count?: number;
  friend_count?: number;
}

interface UserLink {
  fb_id: string;
  name: string;
  profile_url: string;
}

/**
 * Profile Visitor Engine
 * 
 * Given a list of user profile URLs, visits each one and extracts:
 * - Name, FB ID, bio, location, workplace, education
 * - Follower/friend counts
 * 
 * Also discovers NEW users from the "Following/Followers" section on each profile.
 */
export class ProfileVisitor {
  private page: Page;
  private maxProfiles: number;
  private visitedIds: Set<string>;
  private onUserExtracted?: (user: ProfileData) => Promise<void>;
  private onDiscoverUser?: (user: UserLink) => void;

  constructor(
    page: Page,
    options: {
      maxProfiles?: number;
      onUserExtracted?: (user: ProfileData) => Promise<void>;
      onDiscoverUser?: (user: UserLink) => void;
    } = {}
  ) {
    this.page = page;
    this.maxProfiles = options.maxProfiles ?? 50000;
    this.visitedIds = new Set();
    this.onUserExtracted = options.onUserExtracted;
    this.onDiscoverUser = options.onDiscoverUser;
  }

  async visitBulk(users: UserLink[]): Promise<{ visited: number; discovered: number; errors: number }> {
    let visited = 0;
    let discovered = 0;
    let errors = 0;

    const queue = users.filter(u => !this.visitedIds.has(u.fb_id));

    log.info("ProfileVisitor", `starting bulk visit: ${queue.length} profiles in queue`);

    for (let i = 0; i < queue.length; i++) {
      if (visited >= this.maxProfiles) break;

      const user = queue[i];
      if (this.visitedIds.has(user.fb_id)) continue;

      try {
        const profile = await this.visitProfile(user);
        if (profile) {
          this.visitedIds.add(user.fb_id);
          visited++;
          
          if (this.onUserExtracted) {
            await this.onUserExtracted(profile);
          }

          // Discover new users from this profile's connections
          const newUsers = await this.discoverConnections();
          for (const nu of newUsers) {
            if (!this.visitedIds.has(nu.fb_id)) {
              discovered++;
              queue.push(nu);
              if (this.onDiscoverUser) this.onDiscoverUser(nu);
            }
          }
        }

        // Rate limit pause between visits
        const delay = 2000 + Math.random() * 3000;
        log.info("ProfileVisitor", `[${i + 1}/${Math.min(queue.length, visited + queue.length - i)}] delay ${Math.round(delay / 1000)}s`);
        await sleep(delay);

      } catch (err) {
        errors++;
        log.warn("ProfileVisitor", `visit error: ${String(err).substring(0, 100)}`);
        await sleep(5000);
      }
    }

    log.info("ProfileVisitor", `DONE: visited=${visited} discovered=${discovered} errors=${errors}`);
    return { visited, discovered, errors };
  }

  private async visitProfile(user: UserLink): Promise<ProfileData | null> {
    try {
      await this.page.goto(user.profile_url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await this.page.waitForTimeout(3000);

      // Check if redirected (login, blocked, etc.)
      const url = this.page.url();
      if (url.includes("login") || url.includes("checkpoint") || url.includes("block")) {
        log.warn("ProfileVisitor", `blocked/redirected: ${url.substring(0, 60)}`);
        return null;
      }

      // Extract data from profile
      const profile = await this.page.evaluate(() => {
        const data: any = { bio: null, location: null, workplace: null, education: null, relationship: null, birthday: null, follower_count: null, friend_count: null };

        // Bio / About text
        const bioEl = document.querySelector('[data-testid="intro-section-bio"] span, [aria-label*="bio"], span[dir="auto"][style*="white-space: pre-line"]');
        if (bioEl) data.bio = bioEl.textContent?.trim() || null;

        // Location
        const locationEl = document.querySelector('a[href*="places"][role="link"] span, span:has(img[src*="location"]) + span, [aria-label*="lives"]');
        if (locationEl) data.location = (locationEl as HTMLElement).innerText?.trim() || null;

        // Workplace
        const workEl = document.querySelector('[aria-label*="Works at"], [aria-label*="works"], a[href*="pages"][role="link"]');
        if (workEl) data.workplace = (workEl as HTMLElement).innerText?.trim() || null;

        // Education
        const eduEl = document.querySelector('[aria-label*="Studied"], [aria-label*="studied"]');
        if (eduEl) data.education = (eduEl as HTMLElement).innerText?.trim() || null;

        // Relationship
        const relEl = document.querySelector('[aria-label*="Married"], [aria-label*="Single"], [aria-label*="Relationship"], [aria-label*="In a relationship"]');
        if (relEl) data.relationship = (relEl as HTMLElement).innerText?.trim() || null;

        // Follower/friend counts
        const countEls = document.querySelectorAll('a[href*="friends"], a[href*="followers"], a[href*="following"]');
        for (const el of countEls) {
          const text = (el as HTMLElement).innerText || "";
          const match = text.match(/([\d,.]+)/);
          if (match) {
            const count = parseInt(match[1].replace(/[,.]/g, ""));
            if (text.includes("friends") || text.includes("Friends") || text.includes("أصدقاء")) {
              data.friend_count = count;
            } else if (text.includes("follower") || text.includes("Follower") || text.includes("متابع")) {
              data.follower_count = count;
            }
          }
        }

        // Birthday
        const bdayEl = document.querySelector('[aria-label*="birthday"], [aria-label*="Birthday"]');
        if (bdayEl) data.birthday = (bdayEl as HTMLElement).innerText?.trim() || null;

        return data;
      });

      return {
        fb_id: user.fb_id,
        name: user.name,
        profile_url: user.profile_url,
        ...profile,
      };
    } catch (err) {
      log.warn("ProfileVisitor", `extract error: ${String(err).substring(0, 80)}`);
      return null;
    }
  }

  private async discoverConnections(): Promise<UserLink[]> {
    // Extract links to other profiles visible on this profile page
    const users: UserLink[] = [];
    try {
      const found = await this.page.evaluate(() => {
        const results: Array<{ fb_id: string; name: string; profile_url: string }> = [];
        const seen = new Set<string>();
        
        // Friends/followers visible on profile
        const links = document.querySelectorAll('a[href*="profile.php?id="], a[href*="facebook.com/"][aria-label]');
        
        for (const link of links) {
          const href = link.getAttribute("href") || "";
          const pmatch = href.match(/id=(\d{10,25})/);
          const umatch = href.match(/facebook\.com\/([a-zA-Z0-9._-]{3,50})(?:\/|\?|$)/);
          
          let fbId = pmatch ? pmatch[1] : "";
          if (!fbId && umatch) {
            const u = umatch[1];
            if (!/^(photo|video|groups|pages|events|friends|followers|following|about|photos|videos|posts)$/i.test(u)) {
              fbId = u;
            }
          }
          if (!fbId) continue;
          
          const name = link.getAttribute("aria-label") || link.textContent?.trim() || "";
          if (name.length < 2 || name.length > 60 || name.startsWith("http")) continue;
          if (name.includes("photo") || name.includes("Photo")) continue;
          
          if (!seen.has(fbId)) {
            seen.add(fbId);
            results.push({ 
              fb_id: fbId, 
              name, 
              profile_url: href.startsWith("http") ? href.split("?")[0] : `https://www.facebook.com${href.split("?")[0]}` 
            });
          }
        }
        
        return results.slice(0, 20); // max 20 per profile
      });

      // Don't add users we've already visited
      for (const u of found) {
        if (!this.visitedIds.has(u.fb_id)) {
          users.push(u);
        }
      }
    } catch { /* skip */ }
    
    return users;
  }
}
