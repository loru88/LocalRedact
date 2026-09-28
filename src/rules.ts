import {
  type Options,
  type PageText,
  type Rect,
  type Span,
  type Word,
} from "./types";

import {
  IDENTIFIER_RULES,
  italianPayrollAmountSpans,
  italianPayrollDateSpans,
} from "./identifierRules";

export const union = (a: Rect, b: Rect): Rect => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];
const overlaps = (w: Word, spans: Span[]) =>
  spans.some(([s, e]) => w.start < e && w.end > s);
const matches = (text: string, regex: RegExp): Span[] =>
  [...text.matchAll(regex)]
    .filter((m) => m[0].length > 0)
    .map((m) => [m.index, m.index + m[0].length]);
const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function termSpans(text: string, terms: string[]): Span[] {
  return terms.flatMap((term) =>
    term.trim()
      ? matches(text, new RegExp(escapeRegex(term.trim()), "giu"))
      : [],
  );
}

// Text rules are shared by PDF and TXT. Page geometry remains PDF-specific.
export function textRuleSpans(text: string, options: Options) {
  const keep = [
    ...termSpans(text, options.keepTerms),
    ...options.keepRegexes.flatMap((p) => matches(text, new RegExp(p, "giu"))),
    ...(IDENTIFIER_RULES.some(
      (rule) =>
        rule.pack === "italian" && options.enabledRules.includes(rule.id),
    )
      ? italianPayrollAmountSpans(text)
      : []),
  ];
  const mandatory: Span[] = [
    ...IDENTIFIER_RULES.filter((rule) =>
      options.enabledRules.includes(rule.id),
    ).flatMap((rule) => rule.detect(text)),
    ...termSpans(text, options.redactTerms),
  ];
  return { keep, mandatory };
}

export function validateOptions(options: Options) {
  if (
    !Array.isArray(options.enabledRules) ||
    options.enabledRules.some(
      (id) => !IDENTIFIER_RULES.some((rule) => rule.id === id),
    )
  )
    throw new Error("Unknown identifier rule.");
  if (typeof options.headerAllPages !== "boolean")
    throw new Error("Header page selection must be enabled or disabled.");
  if (
    !Number.isFinite(options.headerFraction) ||
    options.headerFraction < 0 ||
    options.headerFraction > 1
  )
    throw new Error("Header percentage must be between 0 and 100.");
  if (!/^[a-zA-Z0-9_-]+$/.test(options.prefix))
    throw new Error(
      "Filename prefix must contain only letters, numbers, hyphens or underscores.",
    );
  for (const pattern of options.keepRegexes) {
    try {
      new RegExp(pattern, "giu");
    } catch {
      throw new Error(`Invalid keep expression: ${pattern}`);
    }
  }
}

export function mergeRectangles(rectangles: Rect[]): Rect[] {
  const sorted = [...rectangles].sort(
    (a, b) => Math.round(a[1] * 10) - Math.round(b[1] * 10) || a[0] - b[0],
  );
  const merged: Rect[] = [];
  for (const r of sorted) {
    const padded: Rect = [r[0] - 1, r[1] - 1, r[2] + 1, r[3] + 1];
    const previous = merged.at(-1);
    if (
      previous &&
      Math.abs(previous[1] - padded[1]) < 2 &&
      padded[0] - previous[2] < 5
    )
      merged[merged.length - 1] = union(previous, padded);
    else merged.push(padded);
  }
  return merged;
}

export function redactionRects(
  page: PageText,
  bounds: Rect,
  options: Options,
  modelSpans: Span[],
  pageIndex: number,
): Rect[] {
  const { text, words } = page;
  const { keep, mandatory } = textRuleSpans(text, options);
  const italianPackEnabled = IDENTIFIER_RULES.some(
    (rule) => rule.pack === "italian" && options.enabledRules.includes(rule.id),
  );
  const italianPayrollDates = italianPackEnabled
    ? italianPayrollDateSpans(text)
    : [];
  const protectedWords = new Set([
    ...words.flatMap((w, i) =>
      overlaps(w, [...keep, ...italianPayrollDates]) ? [i] : [],
    ),
  ]);
  const headerLimit =
    bounds[1] + (bounds[3] - bounds[1]) * options.headerFraction;
  const rects = words.flatMap((w, i) => {
    const forced = overlaps(w, mandatory);
    const optional =
      overlaps(w, modelSpans) ||
      ((pageIndex === 0 || options.headerAllPages) &&
        options.headerFraction > 0 &&
        w.rect[1] < headerLimit);
    return forced || (optional && !protectedWords.has(i)) ? [w.rect] : [];
  });
  return mergeRectangles(rects);
}

// Bound inference memory; overlap retains context at chunk boundaries. Offsets
// are UTF-16 throughout (native JavaScript string indexes), including emoji.
export function textChunks(
  text: string,
  size = 3000,
  overlap = 400,
): { text: string; offset: number }[] {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > start + size / 2) end = space;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    }
    chunks.push({ text: text.slice(start, end), offset: start });
    if (end === text.length) break;
    start = Math.max(start + 1, end - overlap);
    if (/[\uDC00-\uDFFF]/.test(text[start])) start++;
  }
  return chunks;
}
