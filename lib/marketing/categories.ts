/**
 * Marketing categories for purpose-driven organization of deliverables
 * in the Ziki Marketing Output & Final Results Engine (#marketing-engine).
 */

export const MARKETING_CATEGORIES = [
  "All",
  "Brand & Identity",
  "Content & Editorial",
  "Social Media & Community",
  "Acquisition & Advertising",
  "Product Marketing",
  "Public Relations & Communications",
  "SEO & Growth",
  "Research & Strategy",
  "Other / Uncategorised",
] as const;

export type MarketingCategory = (typeof MARKETING_CATEGORIES)[number];

export type ConcreteMarketingCategory = Exclude<MarketingCategory, "All">;

const EXACT_TYPE_MAP: Record<string, ConcreteMarketingCategory> = {
  // Seeded defaults from lib/marketing/default-task-types.ts
  "blog post": "Content & Editorial",
  "social post": "Social Media & Community",
  "email or newsletter": "Content & Editorial",
  "landing page copy": "SEO & Growth",
  "graphic": "Brand & Identity",
  "video": "Brand & Identity",
  "case study": "Content & Editorial",
  "outreach": "Public Relations & Communications",

  // Extended common marketing terms
  "article": "Content & Editorial",
  "newsletter": "Content & Editorial",
  "whitepaper": "Content & Editorial",
  "ebook": "Content & Editorial",
  "social media": "Social Media & Community",
  "community": "Social Media & Community",
  "ad campaign": "Acquisition & Advertising",
  "advertising": "Acquisition & Advertising",
  "paid ads": "Acquisition & Advertising",
  "paid search": "Acquisition & Advertising",
  "paid social": "Acquisition & Advertising",
  "ppc": "Acquisition & Advertising",
  "seo": "SEO & Growth",
  "seo research": "SEO & Growth",
  "backlinks": "SEO & Growth",
  "keyword research": "SEO & Growth",
  "competitor research": "Research & Strategy",
  "market research": "Research & Strategy",
  "customer research": "Research & Strategy",
  "strategy": "Research & Strategy",
  "product marketing": "Product Marketing",
  "product launch": "Product Marketing",
  "positioning": "Product Marketing",
  "press release": "Public Relations & Communications",
  "pr": "Public Relations & Communications",
  "brand": "Brand & Identity",
  "branding": "Brand & Identity",
  "design": "Brand & Identity",
};

/**
 * Maps a task type name to its high-level marketing category.
 * Performs case-insensitive matching with keyword fallbacks.
 */
export function categoryForTaskType(taskTypeName: string | null | undefined): ConcreteMarketingCategory {
  if (!taskTypeName) {
    return "Other / Uncategorised";
  }

  const normalized = taskTypeName.trim().toLowerCase();
  if (!normalized) {
    return "Other / Uncategorised";
  }

  // 1. Direct exact map match
  if (EXACT_TYPE_MAP[normalized]) {
    return EXACT_TYPE_MAP[normalized];
  }

  // 2. Keyword heuristic matching
  if (normalized.includes("blog") || normalized.includes("article") || normalized.includes("newsletter") || normalized.includes("editorial") || normalized.includes("copywrite") || normalized.includes("case study")) {
    return "Content & Editorial";
  }
  if (normalized.includes("social") || normalized.includes("tweet") || normalized.includes("thread") || normalized.includes("linkedin") || normalized.includes("community")) {
    return "Social Media & Community";
  }
  if (normalized.includes("graphic") || normalized.includes("video") || normalized.includes("image") || normalized.includes("logo") || normalized.includes("brand") || normalized.includes("visual") || normalized.includes("creative")) {
    return "Brand & Identity";
  }
  if (normalized.includes("seo") || normalized.includes("backlink") || normalized.includes("growth") || normalized.includes("landing page") || normalized.includes("search engine")) {
    return "SEO & Growth";
  }
  if (normalized.includes("ad") || normalized.includes("advertising") || normalized.includes("campaign") || normalized.includes("acquisition") || normalized.includes("ppc") || normalized.includes("paid")) {
    return "Acquisition & Advertising";
  }
  if (normalized.includes("pr") || normalized.includes("outreach") || normalized.includes("press") || normalized.includes("media") || normalized.includes("comms") || normalized.includes("pitch")) {
    return "Public Relations & Communications";
  }
  if (normalized.includes("research") || normalized.includes("competitor") || normalized.includes("strategy") || normalized.includes("analysis") || normalized.includes("audit") || normalized.includes("insights")) {
    return "Research & Strategy";
  }
  if (normalized.includes("product") || normalized.includes("launch") || normalized.includes("feature") || normalized.includes("positioning")) {
    return "Product Marketing";
  }

  return "Other / Uncategorised";
}

export function isValidMarketingCategory(category: string): category is MarketingCategory {
  return (MARKETING_CATEGORIES as readonly string[]).includes(category);
}
