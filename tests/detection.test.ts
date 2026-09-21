import { describe, expect, it } from "vitest";
import {
  PreTrainedTokenizer,
  Tensor,
  TokenClassificationPipeline,
} from "@huggingface/transformers";
import { readFileSync } from "node:fs";
import { detectSensitiveSpans, tokenSpans } from "../src/detection";
import type { Span } from "../src/types";

// Minimal real ByteLevel BPE tokenizer, with one byte per token. In particular,
// this forces accents and emoji to span tokens instead of hiding that edge case.
const visible = [...Array(256).keys()].filter(
  (b) => (b >= 33 && b <= 126) || (b >= 161 && b <= 172) || b >= 174,
);
let extra = 0;
const alphabet = [...Array(256).keys()].map((b) =>
  String.fromCharCode(visible.includes(b) ? b : 256 + extra++),
);
const tokenizer = new PreTrainedTokenizer(
  {
    version: "1.0",
    added_tokens: [],
    normalizer: null,
    pre_tokenizer: {
      type: "ByteLevel",
      add_prefix_space: false,
      use_regex: true,
    },
    post_processor: null,
    decoder: { type: "ByteLevel" },
    model: {
      type: "BPE",
      vocab: Object.fromEntries(alphabet.map((c, i) => [c, i])),
      merges: [],
    },
  },
  { clean_up_tokenization_spaces: true, model_max_length: 128000 },
);

function classifier(text: string, wanted: Span[], t = tokenizer) {
  const offsets = tokenSpans(
    text,
    t.tokenize(text, { add_special_tokens: true }),
    t.all_special_tokens,
  );
  let first = true;
  const model = Object.assign(
    async () => {
      const scores = new Float32Array(offsets.length * 3);
      offsets.forEach(([start, end], i) => {
        const sensitive = wanted.some(([s, e]) => start < e && end > s);
        const label = sensitive ? (first ? 1 : 2) : 0;
        if (sensitive) first = false;
        scores[i * 3 + label] = 10;
      });
      return { logits: new Tensor("float32", scores, [1, offsets.length, 3]) };
    },
    {
      config: {
        id2label: { 0: "O", 1: "B-private_person", 2: "I-private_person" },
      },
    },
  );
  return new TokenClassificationPipeline({
    task: "token-classification",
    tokenizer: t,
    model: model as unknown as TokenClassificationPipeline["model"],
  });
}

const covered = (spans: Span[], index: number) =>
  spans.some(([s, e]) => s <= index && index < e);

describe("token-index-based AI detection", () => {
  it("reproduces non-contiguous grouping failure and maps each original fragment correctly", async () => {
    const text = "Mario - Rossi";
    const wanted: Span[] = [
      [0, 5],
      [8, 13],
    ];
    const pipeline = classifier(text, wanted);
    const oldOutput = await pipeline(text, { aggregation_strategy: "simple" });
    expect(oldOutput[0].word).toBe("MarioRossi");
    expect(text.includes(oldOutput[0].word)).toBe(false);
    const spans = await detectSensitiveSpans(text, pipeline, []);
    for (let i = 0; i < text.length; i++)
      expect(covered(spans, i)).toBe(covered(wanted, i));
  });

  it("preserves punctuation spacing that the decoder would clean up", async () => {
    const text = "Mario . Rossi";
    const pipeline = classifier(text, [[0, text.length]]);
    const oldOutput = await pipeline(text, { aggregation_strategy: "simple" });
    expect(oldOutput[0].word).toBe("Mario. Rossi");
    const spans = await detectSensitiveSpans(text, pipeline, []);
    expect(spans[0][0]).toBe(0);
    expect(spans.at(-1)![1]).toBe(text.length);
  });

  it("maps repeated names to their actual occurrences and honors category exceptions", async () => {
    const text = "Mario e Mario";
    const pipeline = classifier(text, [[8, 13]]);
    const spans = await detectSensitiveSpans(text, pipeline, []);
    expect(spans.every(([start]) => start >= 8)).toBe(true);
    expect(spans.at(-1)![1]).toBe(13);
    expect(
      await detectSensitiveSpans(text, pipeline, ["private_person"]),
    ).toEqual([]);
  });

  it("expands split UTF-8 tokens to whole source characters with UTF-16 offsets", async () => {
    const text = "😀 Città José �";
    const tokens = tokenizer.tokenize(text);
    const spans = tokenSpans(text, tokens);
    expect(spans.slice(0, 4)).toEqual([
      [0, 2],
      [0, 2],
      [0, 2],
      [0, 2],
    ]);
    const accent = text.indexOf("à");
    expect(spans.filter(([start]) => start === accent)).toEqual([
      [accent, accent + 1],
      [accent, accent + 1],
    ]);
    const detected = await detectSensitiveSpans(
      text,
      classifier(text, [[accent, accent + 1]]),
      [],
    );
    expect(detected.every(([s, e]) => text.slice(s, e) === "à")).toBe(true);
    expect(spans.at(-1)).toEqual([text.length - 1, text.length]);
  });

  it("supports literal special tokens and rejects changed or truncated token streams", () => {
    expect(
      tokenSpans("a<|endoftext|>", ["a", "<|endoftext|>"], ["<|endoftext|>"]),
    ).toEqual([
      [0, 1],
      [1, 14],
    ]);
    expect(() => tokenSpans("Mario . Rossi", ["Mario", ".", "ĠRossi"])).toThrow(
      "could not be aligned",
    );
    expect(() => tokenSpans("Mario Rossi", ["Mario"])).toThrow(
      "could not be aligned",
    );
    expect(() => tokenSpans("à", ["a"])).toThrow("could not be aligned");
  });

  it("handles a sensitive prediction covering only one byte of an accented character", async () => {
    const pipeline = classifier("à", [[0, 1]]);
    pipeline.model = Object.assign(
      async () => ({
        logits: new Tensor(
          "float32",
          new Float32Array([10, 0, 0, 0, 10, 0]),
          [1, 2, 3],
        ),
      }),
      { config: pipeline.model.config },
    ) as unknown as typeof pipeline.model;
    const oldOutput = await pipeline("à", { aggregation_strategy: "simple" });
    expect(oldOutput[0].word).toBe("\uFFFD");
    expect(await detectSensitiveSpans("à", pipeline, [])).toEqual([[0, 1]]);
  });

  it("refuses output if inference returns fewer tokens than the input", async () => {
    const pipeline = classifier("Mario", [[0, 5]]);
    pipeline.model = Object.assign(
      async () => ({
        logits: new Tensor("float32", new Float32Array(3), [1, 1, 3]),
      }),
      { config: pipeline.model.config },
    ) as unknown as typeof pipeline.model;
    await expect(detectSensitiveSpans("Mario", pipeline, [])).rejects.toThrow(
      "inconsistent token predictions",
    );
  });

  it.runIf(!!process.env.PAYSLIP_TOKENIZER_PATH)(
    "aligns the published Privacy Filter tokenizer on Italian and Unicode text",
    async () => {
      const path = process.env.PAYSLIP_TOKENIZER_PATH!;
      const real = new PreTrainedTokenizer(
        JSON.parse(readFileSync(`${path}/tokenizer.json`, "utf8")),
        JSON.parse(readFileSync(`${path}/tokenizer_config.json`, "utf8")),
      );
      for (const text of [
        "Via dell'Unità 12\nCittà: Roma",
        "Mario . Rossi",
        "😀 José � <|endoftext|>",
        "① € 1.234,56\nD’Angelo\t\u00a0ﬁ",
      ]) {
        const result = await detectSensitiveSpans(
          text,
          classifier(text, [[0, text.length]], real),
          [],
        );
        for (let i = 0; i < text.length; i++)
          expect(covered(result, i)).toBe(true);
      }
    },
  );
});
