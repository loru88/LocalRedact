import { textRuleSpans, validateOptions } from "./rules";
import type { Detect, DocumentOutput, Options, Span } from "./types";

export function decodeText(bytes: ArrayBuffer): string {
  const data = new Uint8Array(bytes);
  const encoding =
    data[0] === 0xff && data[1] === 0xfe
      ? "utf-16le"
      : data[0] === 0xfe && data[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(data);
    if (text.includes("\0")) throw new Error("Binary content");
    return text;
  } catch {
    throw new Error(
      "This text file could not be read as UTF-8 or BOM-marked UTF-16. Save it as UTF-8 text and add it again. No document was exported.",
    );
  }
}

function checkedSpan(text: string, [start, end]: Span): Span {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > text.length ||
    start >= end
  )
    throw new Error(
      "A detection could not be matched to the document text. No document was exported.",
    );
  // Never leave half of a surrogate pair in the output.
  if (
    start > 0 &&
    /[\uDC00-\uDFFF]/.test(text[start]) &&
    /[\uD800-\uDBFF]/.test(text[start - 1])
  )
    start--;
  if (
    end < text.length &&
    /[\uD800-\uDBFF]/.test(text[end - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[end])
  )
    end++;
  return [start, end];
}

export async function processText(
  bytes: ArrayBuffer,
  options: Options,
  detect: Detect,
): Promise<Extract<DocumentOutput, { format: "txt" }>> {
  validateOptions(options);
  const source = decodeText(bytes);
  const { keep, mandatory } = textRuleSpans(source, options);
  const predictions =
    options.mode === "model" && source.trim() ? await detect(source) : [];
  const model = predictions.map((span) => checkedSpan(source, span));
  // Keep terms override only AI spans. Mandatory rules are added afterwards.
  const optional = model.flatMap((span) => {
    let parts: Span[] = [span];
    for (const [ks, ke] of keep) {
      parts = parts.flatMap(([s, e]): Span[] => {
        if (ke <= s || ks >= e) return [[s, e]];
        const remainder: Span[] = [];
        if (s < ks) remainder.push([s, ks]);
        if (ke < e) remainder.push([ke, e]);
        return remainder;
      });
    }
    return parts;
  });
  const sorted = [...mandatory, ...optional]
    .map((span) => checkedSpan(source, span))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Span[] = [];
  for (const [start, end] of sorted) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1])
      previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  const parts: string[] = [];
  let cursor = 0;
  let marks = 0;
  for (const [start, end] of merged) {
    parts.push(source.slice(cursor, start));
    // Preserve line endings and boundary whitespace, including blank lines.
    parts.push(
      source.slice(start, end).replace(/\S(?:[^\r\n]*\S)?/g, () => {
        marks++;
        return "[REDACTED]";
      }),
    );
    cursor = end;
  }
  parts.push(source.slice(cursor));
  const text = parts.join("");
  return {
    format: "txt",
    bytes: new TextEncoder().encode(text).buffer,
    text,
    marks,
  };
}
