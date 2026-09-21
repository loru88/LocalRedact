import type {
  Tensor,
  TokenClassificationPipeline,
} from "@huggingface/transformers";
import { CATEGORIES, type Span } from "./types";

// Privacy Filter uses reversible ByteLevel BPE. Its alphabet represents bytes,
// not Unicode characters: an accented character can straddle several tokens.
const byteAlphabet = (() => {
  const bytes = Array.from({ length: 256 }, (_, i) => i);
  const visible = bytes.filter(
    (b) => (b >= 33 && b <= 126) || (b >= 161 && b <= 172) || b >= 174,
  );
  const hidden = bytes.filter((b) => !visible.includes(b));
  return new Map([
    ...visible.map((b) => [String.fromCharCode(b), b] as const),
    ...hidden.map((b, i) => [String.fromCharCode(256 + i), b] as const),
  ]);
})();

const alignmentError = () =>
  new Error(
    "The model tokenizer could not be aligned with the original PDF text. No PDF was exported.",
  );

export function tokenSpans(
  text: string,
  tokens: string[],
  specialTokens: string[] = [],
): Span[] {
  const encoder = new TextEncoder();
  const source = encoder.encode(text);
  const starts: number[] = [];
  const ends: number[] = [];
  let character = 0;
  for (const point of text) {
    for (const _byte of encoder.encode(point)) {
      starts.push(character);
      ends.push(character + point.length);
    }
    character += point.length;
  }
  const special = new Set(specialTokens);
  let cursor = 0;
  const spans = tokens.map((token) => {
    const bytes = special.has(token)
      ? [...encoder.encode(token)]
      : Array.from(token, (c) => {
          const byte = byteAlphabet.get(c);
          if (byte === undefined) throw alignmentError();
          return byte;
        });
    if (!bytes.length) throw alignmentError();
    const start = cursor;
    for (const byte of bytes) {
      if (source[cursor++] !== byte) throw alignmentError();
    }
    // Expand a split UTF-8 character to the whole original Unicode character.
    return [starts[start], ends[cursor - 1]] as Span;
  });
  // Check the entire input, including unlabelled text. No fuzzy matching,
  // punctuation cleanup, occurrence search, or silent truncation is permitted.
  if (cursor !== source.length) throw alignmentError();
  return spans;
}

export async function detectSensitiveSpans(
  text: string,
  classifier: Pick<TokenClassificationPipeline, "tokenizer" | "model">,
  keepCategories: string[],
): Promise<Span[]> {
  const { tokenizer, model } = classifier;
  const inputs = tokenizer(text, { padding: true, truncation: false });
  let logits: Tensor | undefined;
  try {
    const tokens = tokenizer.tokenize(text, { add_special_tokens: true });
    const ids = tokenizer.convert_tokens_to_ids(tokens);
    const inputIds = inputs.input_ids.data;
    if (
      !Array.isArray(ids) ||
      ids.length !== inputIds.length ||
      ids.some((id, i) => id !== Number(inputIds[i]))
    )
      throw alignmentError();
    const offsets = tokenSpans(text, tokens, tokenizer.all_special_tokens);
    // Use the same forward pass and per-token argmax as the pipeline, keeping
    // token indexes instead of decoding and regrouping entity strings.
    const output = await model(inputs);
    logits = output.logits;
    if (
      !logits ||
      logits.dims.length !== 3 ||
      logits.dims[0] !== 1 ||
      logits.dims[1] !== offsets.length
    )
      throw new Error(
        "The model returned inconsistent token predictions. No PDF was exported.",
      );
    const labelCount = logits.dims[2];
    const labels = (model.config as { id2label?: Record<number, string> })
      .id2label;
    if (!labelCount || !labels)
      throw new Error(
        "The model did not provide privacy labels. No PDF was exported.",
      );
    const categories = Array.from({ length: labelCount }, (_, i) => {
      const label = labels[i]?.toLowerCase().replace(/^[bies]-/, "");
      if (label !== "o" && !CATEGORIES.some((c) => c === label))
        throw new Error(
          "The model returned an unknown privacy label. No PDF was exported.",
        );
      return label;
    });
    const scores = logits.data;
    const spans: Span[] = [];
    for (let i = 0; i < offsets.length; i++) {
      let best = 0;
      let highest = -Infinity;
      for (let j = 0; j < labelCount; j++) {
        const score = Number(scores[i * labelCount + j]);
        if (!Number.isFinite(score))
          throw new Error(
            "The model returned invalid confidence scores. No PDF was exported.",
          );
        if (score > highest) {
          highest = score;
          best = j;
        }
      }
      if (
        categories[best] !== "o" &&
        !keepCategories.includes(categories[best])
      )
        spans.push(offsets[i]);
    }
    return spans;
  } finally {
    logits?.dispose();
    for (const tensor of Object.values(inputs)) tensor.dispose();
  }
}
