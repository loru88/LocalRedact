import { describe, expect, it, vi } from "vitest";
import * as mupdf from "mupdf";
import { DEFAULT_OPTIONS, type Options } from "../src/types";
import { termSpans, textChunks, validateOptions } from "../src/rules";
import { processPdf, extractPage } from "../src/pdf";
import { fixture } from "./fixture";

const rules: Options = {
  ...DEFAULT_OPTIONS,
  useAi: false,
  enabledRules: ["italianFiscalCode", "iban"],
  headerFraction: 0.18,
  redactTerms: ["Mario Rossi"],
};

describe("saved PDF redaction", () => {
  it("keeps common Italian payslip amounts clear of AI redaction", async () => {
    const result = await processPdf(
      fixture(),
      { ...DEFAULT_OPTIONS, useAi: true, enabledRules: ["italianFiscalCode"] },
      async (text) =>
        [...text.matchAll(/\d[\d.]*,\d{2}/g)].map((match) => [
          match.index,
          match.index + match[0].length,
        ]),
      () => {},
    );
    const doc = new mupdf.PDFDocument(result.bytes);
    const page = doc.loadPage(0);
    try {
      const text = extractPage(page).text;
      expect(text).toContain("2.500,00");
      expect(text).toContain("1.950,00");
    } finally {
      page.destroy();
      doc.destroy();
    }
  });
  it("keeps Italian payroll date lines clear of AI redaction when Moduli IT is enabled", async () => {
    const input = fixture({ payrollDates: true });
    const result = await processPdf(
      input,
      { ...DEFAULT_OPTIONS, useAi: true, enabledRules: ["italianFiscalCode"] },
      async (text) => {
        const spans: [number, number][] = [];
        for (const value of ["AL 01/01/2026", "dal 1/1/2025 alla data"]) {
          const index = text.indexOf(value);
          if (index >= 0) spans.push([index, index + value.length]);
        }
        return spans;
      },
      () => {},
    );
    const doc = new mupdf.PDFDocument(result.bytes);
    const page = doc.loadPage(0);
    try {
      const text = extractPage(page).text;
      expect(text).toContain("AL 01/01/2026");
      expect(text).toContain("dal 1/1/2025 alla data");
    } finally {
      page.destroy();
      doc.destroy();
    }
  });
  it.each([false, true])(
    "removes split form dates from the saved PDF only when enabled (%s)",
    async (enabled) => {
      const result = await processPdf(
        fixture({ formDate: true }),
        {
          ...DEFAULT_OPTIONS,
          enabledRules: enabled ? ["italianFormDate"] : [],
          keepTerms: ["29", "02", "2000"],
        },
        async () => {
          throw new Error("Unexpected inference");
        },
        () => {},
      );
      const doc = new mupdf.PDFDocument(result.bytes);
      const page = doc.loadPage(0);
      try {
        const text = extractPage(page).text;
        expect(text).toContain("GIORNO MESE ANNO");
        expect(text).toContain("Unrelated value: 12345");
        for (const value of ["29", "02", "2000"]) {
          expect(text.split(/\s+/).includes(value)).toBe(!enabled);
        }
      } finally {
        page.destroy();
        doc.destroy();
      }
    },
  );
  it("permanently removes a generic email with the email rule and AI off", async () => {
    const result = await processPdf(
      fixture(),
      {
        ...DEFAULT_OPTIONS,
        enabledRules: ["email"],
        keepTerms: ["info@example.com"],
      },
      async () => {
        throw new Error("Unexpected inference");
      },
      () => {},
    );
    const doc = new mupdf.PDFDocument(result.bytes);
    const page = doc.loadPage(0);
    try {
      const text = extractPage(page).text;
      expect(text).not.toContain("info@example.com");
      expect(text).toContain("Email:");
      expect(text).toContain("Mario Rossi");
      expect(result.marks).toBeGreaterThan(0);
    } finally {
      page.destroy();
      doc.destroy();
    }
  });
  it.each([false, true])(
    "logs exact page text before inference only when debug is enabled (%s)",
    async (debugPdfText) => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      let calls = 0;
      try {
        await processPdf(
          fixture({ secondPage: "text" }),
          { ...DEFAULT_OPTIONS, useAi: true, debugPdfText },
          async (text) => {
            calls++;
            expect(text).toContain("Mario Rossi");
            if (debugPdfText) {
              expect(log).toHaveBeenCalledTimes(calls);
              expect(log).toHaveBeenLastCalledWith(
                `[LocalRedact] Extracted PDF text — page ${calls}/2`,
                text,
              );
            } else {
              expect(log).not.toHaveBeenCalled();
            }
            return [];
          },
          () => {},
        );
        expect(calls).toBe(2);
        expect(DEFAULT_OPTIONS.debugPdfText).toBe(false);
      } finally {
        log.mockRestore();
      }
    },
  );

  it("leaves header text, banking lines and identifiers intact with flags off", async () => {
    const result = await processPdf(
      fixture(),
      { ...DEFAULT_OPTIONS, useAi: false },
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

  it.each([
    [0, false],
    [0, true],
    [0.18, false],
    [0.18, true],
  ] as const)(
    "uses header percentage %s and every-page setting %s",
    async (headerFraction, headerAllPages) => {
      const result = await processPdf(
        fixture({ secondPage: "text" }),
        {
          ...DEFAULT_OPTIONS,
          headerFraction,
          headerAllPages,
          redactTerms: ["Mario Rossi"],
          keepTerms: ["Gennaio 2026"],
        },
        async () => {
          throw new Error("Unexpected inference");
        },
        () => {},
      );
      const doc = new mupdf.PDFDocument(result.bytes);
      try {
        expect(doc.countPages()).toBe(2);
        for (let i = 0; i < 2; i++) {
          const page = doc.loadPage(i);
          try {
            const text = extractPage(page).text;
            expect(text.includes("ACME")).toBe(
              !(headerFraction > 0 && (i === 0 || headerAllPages)),
            );
            expect(text).toContain("Gennaio 2026");
            expect(text).not.toContain("Mario Rossi");
          } finally {
            page.destroy();
          }
        }
      } finally {
        doc.destroy();
      }
    },
  );

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
      {
        ...DEFAULT_OPTIONS,
        useAi: true,
        headerFraction: 0,
        keepTerms: ["Mario Rossi"],
      },
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
        fixture({ secondPage: "image" }),
        { ...DEFAULT_OPTIONS, useAi: true },
        async () => {
          calls++;
          return [];
        },
        () => {},
      ),
    ).rejects.toThrow("Page 2 has no searchable text");
    expect(calls).toBe(0);
  });

  it.each(["blank", "emptyForm"] as const)(
    "preserves %s pages without inference and redacts surrounding text",
    async (kind) => {
      let calls = 0;
      const result = await processPdf(
        fixture(
          kind === "blank"
            ? { blankPage: true, rotate: 90 }
            : { secondPage: "emptyForm" },
        ),
        { ...rules, useAi: true },
        async () => {
          calls++;
          return [];
        },
        () => {},
      );
      expect(calls).toBe(1);
      expect(result.pages).toBe(2);
      expect(result.previews).toHaveLength(2);
      const doc = new mupdf.PDFDocument(result.bytes);
      const first = doc.loadPage(0);
      const blank = doc.loadPage(1);
      try {
        expect(extractPage(first).text).not.toContain("Mario Rossi");
        expect(extractPage(blank).text).toBe("");
        expect(blank.getBounds()).toEqual(
          kind === "blank" ? [0, 0, 842, 595] : [0, 0, 595, 842],
        );
        const pixmap = blank.toPixmap(
          mupdf.Matrix.identity,
          mupdf.ColorSpace.DeviceRGB,
          false,
          false,
        );
        try {
          expect(pixmap.getPixels().every((value) => value === 255)).toBe(true);
        } finally {
          pixmap.destroy();
        }
      } finally {
        first.destroy();
        blank.destroy();
        doc.destroy();
      }
    },
  );

  it("rejects drawings without text even when they render white", async () => {
    await expect(
      processPdf(
        fixture({ secondPage: "vector" }),
        DEFAULT_OPTIONS,
        async () => [],
        () => {},
      ),
    ).rejects.toThrow("Page 2 has no searchable text");
  });

  it("does not export after an inference failure", async () => {
    await expect(
      processPdf(
        fixture(),
        { ...DEFAULT_OPTIONS, useAi: true },
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
