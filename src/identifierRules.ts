import type { Span } from "./types";

export interface IdentifierRule {
  id: string;
  label: string;
  description: string;
  detect: (text: string) => Span[];
  pack?: string;
}

// Dates printed in Italian payroll forms are useful document context, not
// personal dates to redact. This is used as a PDF-only keep rule for AI/header.
export function italianPayrollDateSpans(text: string): Span[] {
  return [
    ...text.matchAll(
      /^[ \t]*d?al[ \t]+\d{1,2}\/\d{1,2}\/\d{4}(?:[ \t]+alla[ \t]+data)?[ \t]*(?=\r?$)/gim,
    ),
  ].map((match) => [match.index, match.index + match[0].trimEnd().length]);
}

// Keep payroll amounts visible if AI or PDF header detection selects their
// surrounding field. These spans never create redactions themselves.
export function italianPayrollAmountSpans(text: string): Span[] {
  const spans: Span[] = [];
  const lines = [...text.matchAll(/[^\r\n]+/g)];
  const field =
    /\b(?:retribuzione|paga|minimo(?: tabellare)?|contingenza|superminimo|scatti(?: di anzianit[aà])?|straordinari[oaie]?|competenze|trattenute|imponibile(?: previdenziale| fiscale)?|contributi?(?: INPS)?|INPS|IRPEF|addizionali|TFR|netto(?: del mese| in busta)?)\b/i;
  const amount = /(?<![\d/])(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)/g;
  lines.forEach((line, index) => {
    const start = line.index;
    if (start === undefined || !field.test(line[0])) return;
    const values = [...line[0].matchAll(amount)];
    for (const value of values) {
      const valueStart = start + value.index;
      spans.push([valueStart, valueStart + value[0].length]);
    }
    if (
      !values.length &&
      /\b(?:netto(?: del mese| in busta)|totale (?:competenze|trattenute))\b/i.test(
        line[0],
      )
    ) {
      const next = lines[index + 1];
      if (!next || next.index === undefined) return;
      const value = next[0].match(
        /^\s*(?:(?:€|EUR)\s*)?((?:\d{1,3}(?:\.\d{3})*|\d+),\d{2})(?:\s*(?:€|EUR))?\s*$/i,
      );
      if (value) {
        const valueStart = next.index + next[0].indexOf(value[1]);
        spans.push([valueStart, valueStart + value[1].length]);
      }
    }
  });
  return spans;
}

function italianFormDateSpans(text: string): Span[] {
  const spans: Span[] = [];
  // Require the label and three consecutive numeric lines. Keep original
  // offsets and select each number separately, leaving labels/whitespace intact.
  const pattern =
    /\bGIORNO[ \t\u00a0\r\n]+MESE[ \t\u00a0\r\n]+ANNO[ \t\u00a0]*\r?\n[ \t\u00a0]*(\d{1,2})[ \t\u00a0]*\r?\n[ \t\u00a0]*(\d{1,2})[ \t\u00a0]*\r?\n[ \t\u00a0]*(\d{4})(?=[ \t\u00a0]*(?:\r?\n|$))/gi;
  for (const match of text.matchAll(pattern)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (year === 0 || month < 1 || month > 12 || day < 1) continue;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day > days[month - 1]) continue;
    for (const number of match[0].matchAll(/\d+/g)) {
      const start = match.index + number.index;
      spans.push([start, start + number[0].length]);
    }
  }
  return spans;
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
    id: "italianFormDate",
    pack: "italian",
    label: "Modello 730 dates",
    description:
      'Match a valid day, month and four-digit year on three consecutive lines after "GIORNO MESE ANNO". Includes birth dates and other dates with this layout.',
    detect: italianFormDateSpans,
  },
  {
    id: "email",
    label: "Email addresses",
    description:
      "Match common email addresses, including generic mailboxes such as info@. Does not match addresses split across lines, quoted local parts or internationalized addresses.",
    detect: (text) =>
      [
        ...text.matchAll(
          /(?<![A-Z0-9._+-])[A-Z0-9_+-]+(?:\.[A-Z0-9_+-]+)*@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+(?![A-Z0-9-])/giu,
        ),
      ].map((match) => [match.index, match.index + match[0].length]),
  },
  {
    id: "italianFiscalCode",
    pack: "italian",
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
