import {
  Users, FileText, MessageSquare, ThumbsUp, Mail, Layers,
  type LucideIcon,
} from "lucide-react";

export type ExtractionType = "group-members" | "page-followers" | "managed-pages" | "post-comments" | "post-reactions" | "messenger-contacts";

export interface ExtractionTool {
  type: ExtractionType;
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
  speedKey: string;
  sessionKey: string;
  urlPlaceholderKey: string;
  estimateResults: string;
  estimateDuration: string;
}

export const extractionTools: ExtractionTool[] = [
  {
    type: "group-members",
    icon: Users,
    titleKey: "extraction.tools.groupMembers.title",
    descKey: "extraction.tools.groupMembers.desc",
    speedKey: "extraction.tools.groupMembers.speed",
    sessionKey: "extraction.tools.groupMembers.session",
    urlPlaceholderKey: "extraction.tools.groupMembers.urlPlaceholder",
    estimateResults: "5,000 - 50,000",
    estimateDuration: "10 - 45 min",
  },
  {
    type: "page-followers",
    icon: FileText,
    titleKey: "extraction.tools.pageFollowers.title",
    descKey: "extraction.tools.pageFollowers.desc",
    speedKey: "extraction.tools.pageFollowers.speed",
    sessionKey: "extraction.tools.pageFollowers.session",
    urlPlaceholderKey: "extraction.tools.pageFollowers.urlPlaceholder",
    estimateResults: "1,000 - 100,000",
    estimateDuration: "5 - 30 min",
  },
  {
    type: "managed-pages",
    icon: Layers,
    titleKey: "extraction.tools.managedPages.title",
    descKey: "extraction.tools.managedPages.desc",
    speedKey: "extraction.tools.managedPages.speed",
    sessionKey: "extraction.tools.managedPages.session",
    urlPlaceholderKey: "extraction.tools.managedPages.urlPlaceholder",
    estimateResults: "1 - 500 pages",
    estimateDuration: "2 - 10 min",
  },
  {
    type: "post-comments",
    icon: MessageSquare,
    titleKey: "extraction.tools.postComments.title",
    descKey: "extraction.tools.postComments.desc",
    speedKey: "extraction.tools.postComments.speed",
    sessionKey: "extraction.tools.postComments.session",
    urlPlaceholderKey: "extraction.tools.postComments.urlPlaceholder",
    estimateResults: "100 - 10,000",
    estimateDuration: "3 - 15 min",
  },
  {
    type: "post-reactions",
    icon: ThumbsUp,
    titleKey: "extraction.tools.postReactions.title",
    descKey: "extraction.tools.postReactions.desc",
    speedKey: "extraction.tools.postReactions.speed",
    sessionKey: "extraction.tools.postReactions.session",
    urlPlaceholderKey: "extraction.tools.postReactions.urlPlaceholder",
    estimateResults: "500 - 50,000",
    estimateDuration: "5 - 20 min",
  },
  {
    type: "messenger-contacts",
    icon: Mail,
    titleKey: "extraction.tools.messengerContacts.title",
    descKey: "extraction.tools.messengerContacts.desc",
    speedKey: "extraction.tools.messengerContacts.speed",
    sessionKey: "extraction.tools.messengerContacts.session",
    urlPlaceholderKey: "extraction.tools.messengerContacts.urlPlaceholder",
    estimateResults: "50 - 5,000",
    estimateDuration: "2 - 10 min",
  },
];

export interface ExtractionConfig {
  type: ExtractionType;
  session: string;
  url: string;
  name: string;
  notes: string;
  skipDuplicates: boolean;
  retryFailed: boolean;
  savePreset: boolean;
  enableNotifications: boolean;
  // Group Members specific
  groupVisibility: "public" | "private";
  extractProfileUrl: boolean;
  extractProfileId: boolean;
  extractDisplayName: boolean;
  extractProfileImage: boolean;
  extractJoinDate: boolean;
}

export const defaultConfig: ExtractionConfig = {
  type: "group-members",
  session: "",
  url: "",
  name: "",
  notes: "",
  skipDuplicates: true,
  retryFailed: true,
  savePreset: false,
  enableNotifications: true,
  groupVisibility: "public",
  extractProfileUrl: true,
  extractProfileId: true,
  extractDisplayName: true,
  extractProfileImage: false,
  extractJoinDate: false,
};

export interface GroupMemberResult {
  id: string;
  name: string;
  profileId: string;
  profileUrl: string;
  avatar: string | null;
  joinedDate: string | null;
  selected: boolean;
}

export const mockResults: GroupMemberResult[] = Array.from({ length: 47 }, (_, i) => {
  const names = ["Ahmed Al-Zahrani", "Sara Al-Otaibi", "Khalid Al-Mansour", "Noura Al-Qahtani", "Faisal Al-Dossari", "Reem Al-Harbi", "Mohammed Al-Shehri", "Huda Al-Subaie", "Abdullah Al-Ghamdi", "Fatima Al-Nasser"];
  const name = names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : "");
  return {
    id: `m${i + 1}`,
    name,
    profileId: `1000${String(23456789 + i).padStart(8, "0")}`,
    profileUrl: `facebook.com/${1000 + i}`,
    avatar: null,
    joinedDate: i % 3 === 0 ? `2023-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}` : null,
    selected: false,
  };
});

export function getTool(type: ExtractionType): ExtractionTool | undefined {
  return extractionTools.find((t) => t.type === type);
}

export function isValidFacebookUrl(url: string): boolean {
  if (!url) return false;
  return /^https?:\/\/(www\.)?facebook\.com\/.+/i.test(url) || /^https?:\/\/(www\.)?fb\.com\/.+/i.test(url);
}
