import type { Span } from "./types";

export interface IdentifierRule {
  id: string;
  label: string;
  description: string;
  detect: (text: string) => Span[];
}

function ibanSpans(text: string): Span[] {
  const spans: Span[] = [];
  // Scan without changing source offsets. Spaces (including NBSP) are allowed,
  // but never cross a line. Prefer the longest checksum-valid word boundary:
  // a shorter prefix can coincidentally have the same checksum.
  for (const start of text.matchAll(/\b[A-Z]{2}\d{2}/gi)) {
    let compact = "";
    let matchedEnd: number | undefined;
    for (let end = start.index; end < text.length; end++) {
      const char = text[end];
      if (/^[ \t\u00a0]$/.test(char)) continue;
      if (!/^[A-Z0-9]$/i.test(char) || compact.length === 34) break;
      compact += char.toUpperCase();
      if (compact.length < 14 || /[A-Z0-9_]/i.test(text[end + 1] ?? ""))
        continue;
      const digits = (compact.slice(4) + compact.slice(0, 4)).replace(
        /[A-Z]/g,
        (letter) => String(letter.charCodeAt(0) - 55),
      );
      let remainder = 0;
      for (const digit of digits)
        remainder = (remainder * 10 + Number(digit)) % 97;
      if (remainder === 1) {
        matchedEnd = end + 1;
      }
    }
    if (matchedEnd !== undefined) spans.push([start.index, matchedEnd]);
  }
  return spans;
}

// Add an entry here to expose another optional text rule in both the UI and
// PDF/TXT processing. Country-specific patterns stay outside the shared engine.
export const IDENTIFIER_RULES: readonly IdentifierRule[] = [
  {
    id: "italianFiscalCode",
    label: "Italian fiscal codes",
    description:
      "Match the 16-character personal fiscal-code pattern; no checksum validation.",
    detect: (text) =>
      [...text.matchAll(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi)].map(
        (match) => [match.index, match.index + match[0].length],
      ),
  },
  {
    id: "iban",
    label: "IBAN bank accounts",
    description:
      "Match compact or space-separated IBANs with a valid checksum across countries. Country-specific lengths are not validated.",
    detect: ibanSpans,
  },
];
