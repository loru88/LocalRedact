import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { DEFAULT_OPTIONS, type Options } from "../src/types";
import { termSpans, textChunks, validateOptions } from "../src/rules";
import { processPdf, extractPage } from "../src/pdf";
import { fixture } from "./fixture";

const rules: Options = {
  ...DEFAULT_OPTIONS,
  mode: "rules",
  enabledRules: ["italianFiscalCode", "iban"],
  redactHeader: true,
  redactTerms: ["Mario Rossi"],
};

describe("saved PDF redaction", () => {
  it("leaves header text, banking lines and identifiers intact with flags off", async () => {
    const result = await processPdf(
      fixture(),
      { ...DEFAULT_OPTIONS, mode: "rules" },
      async () => [],
      () => {},
    );
    const doc = new mupdf.PDFDocument(result.bytes);
    const page = doc.loadPage(0);
    try {
      const text = extractPage(page).text;
      for (const value of [
        "ACME",
        "BANCA ESEMPIO",
        "RSSMRA80A01H501U",
        "IT60X0542811101000000123456",
        "GB82 WEST",
      ])
        expect(text).toContain(value);
      expect(result.marks).toBe(0);
    } finally {
      page.destroy();
      doc.destroy();
    }
  });

  it("preserves header images while permanently removing header text", async () => {
    const input = fixture({ headerImage: true });
    const source = new mupdf.PDFDocument(input);
    const sourcePage = source.loadPage(0);
    expect(extractPage(sourcePage).images).toHaveLength(1);
    sourcePage.destroy();
    source.destroy();
    const result = await processPdf(
      input,
      rules,
      async () => [],
      () => {},
    );
    const output = new mupdf.PDFDocument(result.bytes);
    const page = output.loadPage(0);
    expect(extractPage(page).images).toHaveLength(1);
    expect(extractPage(page).text).not.toContain("ACME");
    const pixels = page.toPixmap(
      mupdf.Matrix.identity,
      mupdf.ColorSpace.DeviceRGB,
      false,
      false,
    );
    const index = 115 * pixels.getStride() + 65 * 3;
    expect([...pixels.getPixels().slice(index, index + 3)]).toEqual([
      180, 180, 180,
    ]);
    pixels.destroy();
    page.destroy();
    output.destroy();
  });

  it("ignores empty keep expressions instead of preserving every word", async () => {
    const result = await processPdf(
      fixture(),
      { ...rules, keepRegexes: [""] },
      async () => [],
      () => {},
    );
    const output = new mupdf.PDFDocument(result.bytes);
    const page = output.loadPage(0);
    expect(extractPage(page).text).not.toContain("ACME");
    page.destroy();
    output.destroy();
  });

  it("removes underlying text, metadata and ancillary content while preserving explicit keep terms", async () => {
    const result = await processPdf(
      fixture(),
      {
        ...rules,
        keepTerms: [
          "Gennaio 2026",
          "RSSMRA80A01H501U",
          "Mario Rossi",
          "BANCA ESEMPIO",
          "IT60X0542811101000000123456",
        ],
      },
      async () => {
        throw new Error("Rules mode must not use the model");
      },
      () => {},
    );
    expect(result.marks).toBeGreaterThan(0);
    expect(result.previews).toHaveLength(1);
    expect([...new Uint8Array(result.previews[0]).slice(0, 4)]).toEqual([
      137, 80, 78, 71,
    ]);
    const doc = new mupdf.PDFDocument(result.bytes);
    const page = doc.loadPage(0);
    const text = extractPage(page).text;
    for (const sensitive of [
      "ACME",
      "Via Esempio",
      "Mario",
      "Rossi",
      "RSSMRA80A01H501U",
      "IT60",
      "GB82",
      "WEST",
      "7654",
    ])
      expect(text).not.toContain(sensitive);
    for (const preserved of [
      "BANCA ESEMPIO",
      "123456789",
      "Gennaio 2026",
      "NETTO DEL MESE",
      "1.950,00",
      "2.500,00",
    ])
      expect(text).toContain(preserved);
    expect(doc.getMetaData("info:Author")).toBeFalsy();
    expect(doc.getMetaData("info:Title")).toBeFalsy();
    expect(doc.getTrailer().get("Root", "Metadata").isNull()).toBe(true);
    expect(Object.keys(doc.getEmbeddedFiles())).toHaveLength(0);
    expect(page.getAnnotations()).toHaveLength(0);
    page.destroy();
    doc.destroy();
  });

  it("keeps source bytes intact and respects model exceptions", async () => {
    const input = fixture();
    const original = new Uint8Array(input).slice();
    const result = await processPdf(
      input,
      { ...DEFAULT_OPTIONS, headerFraction: 0, keepTerms: ["Mario Rossi"] },
      async (text) =>
        termSpans(text, [
          "Mario Rossi",
          "Gennaio 2026",
          "1.950,00",
          "Via Esempio",
        ]),
      () => {},
    );
    expect(new Uint8Array(input)).toEqual(original);
    const doc = new mupdf.PDFDocument(result.bytes);
    const page = doc.loadPage(0);
    const text = extractPage(page).text;
    expect(text).toContain("Mario Rossi");
    expect(text).not.toContain("Gennaio 2026");
    expect(text).not.toContain("1.950,00");
    expect(text).not.toContain("Via Esempio");
    page.destroy();
    doc.destroy();
  });

  it("redacts rotated pages using MuPDF coordinates", async () => {
    const result = await processPdf(
      fixture({ rotate: 90 }),
      { ...rules, headerFraction: 0 },
      async () => [],
      () => {},
    );
    const doc = new mupdf.PDFDocument(result.bytes);
    const page = doc.loadPage(0);
    expect(extractPage(page).text).not.toContain("Mario");
    page.destroy();
    doc.destroy();
  });

  it("refuses the entire document when any page has no text, before inference", async () => {
    let calls = 0;
    await expect(
      processPdf(
        fixture({ blankPage: true }),
        DEFAULT_OPTIONS,
        async () => {
          calls++;
          return [];
        },
        () => {},
      ),
    ).rejects.toThrow("Page 2 has no searchable text");
    expect(calls).toBe(0);
  });

  it("does not export after an inference failure", async () => {
    await expect(
      processPdf(
        fixture(),
        DEFAULT_OPTIONS,
        async () => {
          throw new Error("Model failed");
        },
        () => {},
      ),
    ).rejects.toThrow("Model failed");
  });
});

describe("model span alignment and options", () => {
  it("covers long input without gaps and preserves chunk offsets", () => {
    const text = "Città 😀 Mario Rossi ".repeat(600);
    const chunks = textChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    let covered = 0;
    for (const chunk of chunks) {
      expect(chunk.offset).toBeLessThanOrEqual(covered);
      expect(chunk.text).toBe(
        text.slice(chunk.offset, chunk.offset + chunk.text.length),
      );
      expect(chunk.text.length).toBeLessThanOrEqual(3000);
      covered = chunk.offset + chunk.text.length;
    }
    expect(covered).toBe(text.length);
  });
  it("validates user expressions and output prefixes", () => {
    expect(() => validateOptions({ ...rules, keepRegexes: ["["] })).toThrow(
      "Invalid keep",
    );
    expect(() => validateOptions({ ...rules, prefix: "../private" })).toThrow(
      "prefix",
    );
    expect(() => validateOptions({ ...rules, headerFraction: NaN })).toThrow(
      "percentage",
    );
  });
});
