import type { Page } from "playwright";
import type { ExtractionType, JobContext } from "../types.js";
import { BaseExtractor } from "./base.js";
import { GroupMembersExtractor } from "./group-members.js";
import { PageFollowersExtractor } from "./page-followers.js";
import { PostCommentsExtractor } from "./post-comments.js";
import { PostReactionsExtractor } from "./post-reactions.js";
import { MessengerContactsExtractor } from "./messenger-contacts.js";
import { IgFollowersExtractor } from "./ig-followers.js";
import { IgHashtagPostsExtractor } from "./ig-hashtag-posts.js";
import { IgPostUsersExtractor } from "./ig-post-users.js";
import { IgProfileInfoExtractor } from "./ig-profile-info.js";
import { IgUserSearchExtractor } from "./ig-user-search.js";

export function createExtractor(
  type: ExtractionType,
  page: Page,
  ctx: JobContext,
  secondaryPages?: Array<{ sessionId: string; page: Page }>,
): BaseExtractor {
  switch (type) {
    case "groups":
      return new GroupMembersExtractor(page, ctx, secondaryPages);
    case "pages":
      return new PageFollowersExtractor(page, ctx, secondaryPages);
    case "post_comments":
      return new PostCommentsExtractor(page, ctx, secondaryPages);
    case "post_reactions":
      return new PostReactionsExtractor(page, ctx, secondaryPages);
    case "messenger_contacts":
      return new MessengerContactsExtractor(page, ctx, secondaryPages);
    case "ig_followers":
    case "ig_following":
      return new IgFollowersExtractor(page, ctx, secondaryPages);
    case "ig_post_commenters":
    case "ig_post_engagers":
      return new IgPostUsersExtractor(page, ctx, secondaryPages);
    case "ig_hashtag_posts":
      return new IgHashtagPostsExtractor(page, ctx, secondaryPages);
    case "ig_profile_info":
      return new IgProfileInfoExtractor(page, ctx, secondaryPages);
    case "ig_user_search":
      return new IgUserSearchExtractor(page, ctx, secondaryPages);
    default:
      throw new Error(`Unsupported extraction type: ${type}`);
  }
}
