import { REPORT_SUMMARY_MAX_CHARS, REPORT_SUMMARY_MAX_LINES, REPORT_SUMMARY_MIN_CHARS } from "@/lib/validations/report-summary";

const TITLE_MAX = 120;

function stripPlain(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\u0000/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*`>|]/g, " ")
    .replace(/[ \t]+/g, " ");
}

/**
 * Draft a single-line title and up-to-three-line plain summary from the
 * contributor portal's one-box prompt so guests can file with just one field.
 */
export function draftReportFromPrompt(prompt: string): { title: string; summary: string } {
  const cleaned = stripPlain(prompt)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const joined = cleaned.join("\n");
  if (!joined) return { title: "", summary: "" };

  const firstLine = cleaned[0] ?? "";
  const sentenceEnd = firstLine.search(/[.!?](?:\s|$)/);
  const rawTitle = sentenceEnd >= 12 ? firstLine.slice(0, sentenceEnd + 1) : firstLine;
  const title = rawTitle.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);

  const summaryLines = cleaned.slice(0, REPORT_SUMMARY_MAX_LINES);
  let summary = summaryLines.join("\n").slice(0, REPORT_SUMMARY_MAX_CHARS).trim();
  if (summary.length > 0 && summary.length < REPORT_SUMMARY_MIN_CHARS) {
    summary = `Guest report: ${summary}`.slice(0, REPORT_SUMMARY_MAX_CHARS).trim();
  }
  if (summary.length > 0 && summary.length < REPORT_SUMMARY_MIN_CHARS) {
    summary = `${summary} (submitted via portal)`.slice(0, REPORT_SUMMARY_MAX_CHARS).trim();
  }
  return { title, summary };
}

/** Extract a single plain sentence from the maintainer's project goal/brief. */
export function portalIntroSentence(goal: string | null | undefined, projectName: string): string {
  if (goal) {
    const plain = stripPlain(goal).replace(/\s+/g, " ").trim();
    if (plain.length >= 10) {
      const match = /^(.{10,200}?[.!?])(?:\s|$)/.exec(plain);
      return match ? match[1] : plain.slice(0, 200);
    }
  }
  return `Tell the ${projectName} team what went wrong or what would help.`;
}
