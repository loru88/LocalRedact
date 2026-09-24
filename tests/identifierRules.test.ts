import { describe, expect, it } from "vitest";
import { processText } from "../src/text";
import { DEFAULT_OPTIONS } from "../src/types";
import { validateOptions } from "../src/rules";

const sourceBytes = (text: string) => new TextEncoder().encode(text).buffer;
const run = async (text: string, enabledRules: string[]) =>
  (
    await processText(
      sourceBytes(text),
      { ...DEFAULT_OPTIONS, mode: "rules", enabledRules, keepRegexes: [".+"] },
      async () => {
        throw new Error("Unexpected inference");
      },
    )
  ).text;

describe("optional identifier rules", () => {
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
