import { describe, expect, it, vi } from "vitest";
import { decodeText, processText } from "../src/text";
import { DEFAULT_OPTIONS, type Options, type Span } from "../src/types";

const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const rules: Options = { ...DEFAULT_OPTIONS, mode: "rules" };
const noModel = vi.fn(async (): Promise<Span[]> => {
  throw new Error("Unexpected model call");
});

describe("TXT processing", () => {
  it("replaces repeated case-insensitive terms and preserves Unicode, indentation and line endings", async () => {
    const source =
      "Résumé 😀\r\n  Maria Rossi\r\n\r\nContact: MARIA ROSSI\nEnd\r";
    const input = bytes(source);
    const result = await processText(
      input,
      { ...rules, redactTerms: ["Maria Rossi"] },
      noModel,
    );
    expect(result.text).toBe(
      "Résumé 😀\r\n  [REDACTED]\r\n\r\nContact: [REDACTED]\nEnd\r",
    );
    expect(decodeText(result.bytes)).toBe(result.text);
    expect(result.marks).toBe(2);
    expect(decodeText(input)).toBe(source);
  });

  it("ignores PDF header and salary layout rules", async () => {
    const source = "First line\nNETTO DEL MESE Maria Rossi\nLast line";
    expect(
      (
        await processText(
          bytes(source),
          { ...rules, headerFraction: 1 },
          noModel,
        )
      ).text,
    ).toBe(source);
    const start = source.indexOf("Maria Rossi");
    const result = await processText(
      bytes(source),
      DEFAULT_OPTIONS,
      async () => [[start, start + 11]],
    );
    expect(result.text).toBe(
      "First line\nNETTO DEL MESE [REDACTED]\nLast line",
    );
  });

  it("applies mandatory rules over keep terms and expressions", async () => {
    const source =
      "RSSMRA80A01H501U\r\nIBAN IT60X0542811101000000123456\r\nMaria Rossi\r\nEnd";
    const result = await processText(
      bytes(source),
      {
        ...rules,
        keepRegexes: ["[^\\r\\n]+"],
        keepTerms: ["Maria Rossi"],
        redactTerms: ["Maria Rossi"],
      },
      noModel,
    );
    expect(result.text).toBe("[REDACTED]\r\n[REDACTED]\r\n[REDACTED]\r\nEnd");
    expect(result.marks).toBe(3);
  });

  it("merges overlapping and duplicate AI detections without shifting later matches", async () => {
    const source = "Maria Rossi met Luca Bianchi.";
    const result = await processText(
      bytes(source),
      DEFAULT_OPTIONS,
      async () => [
        [0, 5],
        [5, 11],
        [0, 11],
        [16, 28],
        [16, 20],
      ],
    );
    expect(result.text).toBe("[REDACTED] met [REDACTED].");
    expect(result.marks).toBe(2);
  });

  it("keeps only the requested part of an AI detection", async () => {
    const result = await processText(
      bytes("Maria Rossi met Luca"),
      {
        ...DEFAULT_OPTIONS,
        keepTerms: ["Rossi"],
        keepRegexes: ["Luca"],
      },
      async () => [
        [0, 11],
        [16, 20],
      ],
    );
    expect(result.text).toBe("[REDACTED] Rossi met Luca");
  });

  it("preserves CRLF and blank lines inside a multiline match", async () => {
    const result = await processText(
      bytes("Start\r\n  Maria\r\n\r\nRossi  \r\nEnd"),
      {
        ...rules,
        redactTerms: ["Maria\r\n\r\nRossi"],
      },
      noModel,
    );
    expect(result.text).toBe(
      "Start\r\n  [REDACTED]\r\n\r\n[REDACTED]  \r\nEnd",
    );
  });

  it("reads UTF-8 BOM and UTF-16 BOM files and exports UTF-8", async () => {
    const text = "Città 😀\r\nMaria";
    const le = Buffer.from(text, "utf16le");
    const be = Buffer.from(le).swap16();
    for (const encoded of [
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
      Buffer.concat([Buffer.from([0xff, 0xfe]), le]),
      Buffer.concat([Buffer.from([0xfe, 0xff]), be]),
    ]) {
      const result = await processText(
        new Uint8Array(encoded).buffer,
        { ...rules, redactTerms: ["Maria"] },
        noModel,
      );
      expect(
        new TextDecoder("utf-8", { fatal: true }).decode(result.bytes),
      ).toBe("Città 😀\r\n[REDACTED]");
    }
  });

  it("rejects malformed encodings and binary content before inference", async () => {
    const detect = vi.fn(async (): Promise<Span[]> => []);
    for (const data of [
      [0xc3, 0x28],
      [0, 1, 2],
      [0xff, 0xfe, 0x61],
    ]) {
      await expect(
        processText(new Uint8Array(data).buffer, DEFAULT_OPTIONS, detect),
      ).rejects.toThrow("Save it as UTF-8");
    }
    expect(detect).not.toHaveBeenCalled();
  });

  it("preserves empty and whitespace-only files without downloading a model", async () => {
    for (const text of ["", " \r\n\t"]) {
      const result = await processText(bytes(text), DEFAULT_OPTIONS, noModel);
      expect(result.text).toBe(text);
      expect(result.marks).toBe(0);
    }
  });

  it("fails instead of exporting on model errors or invalid span offsets", async () => {
    await expect(
      processText(bytes("Maria"), DEFAULT_OPTIONS, async () => {
        throw new Error("Model failed");
      }),
    ).rejects.toThrow("Model failed");
    for (const span of [
      [-1, 3],
      [0, 50],
      [2, 1],
      [0, NaN],
    ] as Span[]) {
      await expect(
        processText(bytes("Maria"), DEFAULT_OPTIONS, async () => [span]),
      ).rejects.toThrow("No document was exported");
    }
  });
});
