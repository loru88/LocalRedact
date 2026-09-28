import { describe, expect, it } from "vitest";
import { processText } from "../src/text";
import { DEFAULT_OPTIONS } from "../src/types";
import { validateOptions } from "../src/rules";

const sourceBytes = (text: string) => new TextEncoder().encode(text).buffer;
const run = async (text: string, enabledRules: string[]) =>
  (
    await processText(
      sourceBytes(text),
      { ...DEFAULT_OPTIONS, useAi: false, enabledRules, keepRegexes: [".+"] },
      async () => {
        throw new Error("Unexpected inference");
      },
    )
  ).text;

describe("optional identifier rules", () => {
  it.each([
    ["GIORNO MESE ANNO", "29\n02\n2000"],
    ["giorno\n mese\n anno", "1\n9\n1985"],
    ["GIORNO\tMESE\u00a0ANNO", " 31 \r\n 12\r\n1999"],
  ])(
    "redacts valid form dates after %s while preserving labels and separators",
    async (label, date) => {
      const text = `😀 ${label}\n${date}\nComune`;
      expect(await run(text, [])).toBe(text);
      expect(await run(text, ["italianFormDate"])).toBe(
        `😀 ${label}\n${date.replace(/\d+/g, "[REDACTED]")}\nComune`,
      );
    },
  );
  it.each([
    "29\n02\n1900",
    "29\n02\n2001",
    "31\n04\n2000",
    "00\n01\n2000",
    "01\n00\n2000",
    "01\n13\n2000",
    "01\n01\n0000",
    "01\n01\n99",
    "01\n01\n20000",
    "01\n\n01\n2000",
    "01\nlabel\n01\n2000",
    "01 01 2000",
    "01\n01\n2000 extra",
    "101\n01\n2000",
  ])(
    "leaves invalid dates or nonconsecutive numeric lines unchanged: %s",
    async (date) => {
      const text = `GIORNO MESE ANNO\n${date}`;
      expect(await run(text, ["italianFormDate"])).toBe(text);
    },
  );
  it("requires the label and handles repeated dates without shifting offsets", async () => {
    const date = "GIORNO MESE ANNO\n15\n06\n1980";
    const text = `15\n06\n1980\n${date}\n${date}`;
    const redacted = "GIORNO MESE ANNO\n[REDACTED]\n[REDACTED]\n[REDACTED]";
    expect(await run(text, ["italianFormDate"])).toBe(
      `15\n06\n1980\n${redacted}\n${redacted}`,
    );
  });
  it("keeps Italian payslip amounts clear with Moduli IT enabled", async () => {
    const text =
      "Retribuzione ordinaria 2.500,00\nNETTO DEL MESE\n1.950,00\nIRPEF 123,45";
    expect(await run(text, [])).toBe(text);
    const result = await processText(
      sourceBytes(text),
      { ...DEFAULT_OPTIONS, useAi: true, enabledRules: ["italianFiscalCode"] },
      async (source) =>
        [...source.matchAll(/\d[\d.]*,\d{2}/g)].map((match) => [
          match.index,
          match.index + match[0].length,
        ]),
    );
    expect(result.text).toBe(text);
  });
  it("redacts generic and personal emails only when enabled, overriding keep rules", async () => {
    const text =
      "😀 Email: info@example.com; <Mario.Rossi+tax@sub.example.it>, info@example.com.";
    expect(await run(text, [])).toBe(text);
    expect(await run(text, ["email"])).toBe(
      "😀 Email: [REDACTED]; <[REDACTED]>, [REDACTED].",
    );
  });
  it("does not treat incomplete or split email addresses as common emails", async () => {
    const text =
      "name@localhost name@\nexample.com name..surname@example.com name@-example.com";
    expect(await run(text, ["email"])).toBe(text);
  });
  it("leaves identifiers and banking lines unchanged by default", async () => {
    const text =
      "BANCA ESEMPIO Conto 123456789\nIBAN IT60X0542811101000000123456\nRSSMRA80A01H501U";
    expect(await run(text, [])).toBe(text);
  });
  it("enables each rule independently and overrides keep rules only for its matches", async () => {
    const text = "RSSMRA80A01H501U IT60X0542811101000000123456";
    expect(await run(text, ["italianFiscalCode"])).toBe(
      "[REDACTED] IT60X0542811101000000123456",
    );
    expect(await run(text, ["iban"])).toBe("RSSMRA80A01H501U [REDACTED]");
  });
  it.each([
    "IT60X0542811101000000123456",
    "DE89370400440532013000",
    "GB82WEST12345698765432",
    "FR1420041010050500013M02606",
    "NO9386011117947",
    "NL91ABNA0417164300",
    "GB82 WEST 1234 5698 7654 32",
    "de89 3704 0044 0532 0130 00",
    "FR14\u00a02004\u00a01010\u00a0050\u00a0500\u00a0013M02606",
  ])(
    "redacts an international IBAN while retaining adjacent text: %s",
    async (iban) => {
      expect(
        await run(`😀 IBAN ${iban}; account holder remains`, ["iban"]),
      ).toBe("😀 IBAN [REDACTED]; account holder remains");
    },
  );
  it("does not leave an IBAN suffix when a shorter prefix also passes the checksum", async () => {
    expect(await run("GB82 WEST 0000 0006 0000 76", ["iban"])).toBe(
      "[REDACTED]",
    );
  });
  it("retains labels and unrelated banking text, and handles repeated matches", async () => {
    expect(
      await run(
        "BANCA SWIFT IBAN GB82 WEST 1234 5698 7654 32\nIBAN DE89370400440532013000",
        ["iban"],
      ),
    ).toBe("BANCA SWIFT IBAN [REDACTED]\nIBAN [REDACTED]");
  });
  it("does not match invalid checksums, embedded codes or numbers split across lines", async () => {
    const text =
      "DE00370400440532013000; xDE89370400440532013000; GB82 WEST\n1234 5698 7654 32";
    expect(await run(text, ["iban"])).toBe(text);
  });
  it("rejects unknown flags", () => {
    expect(() =>
      validateOptions({ ...DEFAULT_OPTIONS, enabledRules: ["missing"] }),
    ).toThrow("Unknown identifier rule");
  });
});
