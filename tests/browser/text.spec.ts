import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fixture } from "../fixture";

test("redacts TXT locally, previews literal text and downloads matching UTF-8 output", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await expect(
    page.getByLabel("add AI detection", { exact: true }),
  ).not.toBeChecked();
  await page.getByLabel("Always redact", { exact: true }).fill("Maria Rossi");
  const markup = "<img src=https://example.invalid/private onerror=alert(1)>";
  const source = `Città 😀\r\nMaria Rossi\r\n${markup}\r\n${"x".repeat(500)}\r\n`;
  const expected = source.replace("Maria Rossi", "[REDACTED]");
  await page.locator("input[type=file]").setInputFiles({
    name: "notes.TXT",
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await page
    .getByRole("button", { name: "Redact document", exact: true })
    .click();
  const preview = page.getByLabel("Redacted text document", { exact: true });
  await expect(preview).toBeVisible();
  expect(await preview.textContent()).toBe(expected);
  await expect(preview.locator("img")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next page" })).toHaveCount(0);
  await expect(
    page.getByText("Skip AI categories", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".intro-note")).toHaveCount(0);
  await expect(
    page.getByText("Text document · 1 redactions · rules only"),
  ).toBeVisible();
  await page.getByLabel("add AI detection", { exact: true }).check();
  await expect(
    page.getByText("Rules-only result:", { exact: false }),
  ).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download document" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("localredact_0001.txt");
  expect(await readFile((await download.path())!, "utf8")).toBe(expected);
  expect(
    requests.filter(
      (url) =>
        !url.startsWith("http://127.0.0.1:4173/") && !url.startsWith("blob:"),
    ),
  ).toEqual([]);
  expect(requests.some((url) => /mupdf|transformers|ort-wasm/.test(url))).toBe(
    false,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/text-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Clear files" }).click();
  await expect(preview).toHaveCount(0);
});

test("continues a mixed batch after invalid TXT and switches between text and PDF previews", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("add AI detection", { exact: true }).uncheck();
  await page.getByLabel("Always redact", { exact: true }).fill("Mario Rossi");
  await page.locator("input[type=file]").setInputFiles([
    {
      name: "invalid.txt",
      mimeType: "text/plain",
      buffer: Buffer.from([0xc3, 0x28]),
    },
    {
      name: "sample.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(fixture()),
    },
    {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Mario Rossi\nEnd"),
    },
  ]);
  await page.getByRole("button", { name: "Redact 3 documents" }).click();
  await expect(page.getByText(/Save it as UTF-8/)).toBeVisible();
  await expect(page.getByLabel("Redacted text document")).toHaveText(
    "[REDACTED]\nEnd",
  );
  await page
    .locator(".file-row")
    .filter({ hasText: "sample.pdf" })
    .getByRole("button", { name: "Review" })
    .click();
  await expect(
    page.getByRole("img", { name: "Redacted document, page 1" }),
  ).toBeVisible();
  await expect(
    page.getByText("localredact_0002.pdf", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Redacted text document")).toHaveCount(0);
  await page
    .locator(".file-row")
    .filter({ hasText: "notes.txt" })
    .getByRole("button", { name: "Review" })
    .click();
  await expect(
    page.getByText("localredact_0003.txt", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Redacted document, page 1" }),
  ).toHaveCount(0);
});

test("TXT model download failure does not export a rules-only result", async ({
  page,
  context,
}) => {
  await context.route("https://huggingface.co/**", (route) =>
    route.abort("failed"),
  );
  await page.goto("/");
  await page.getByLabel("add AI detection", { exact: true }).check();
  await page.getByText("Advanced options", { exact: true }).click();
  await expect(
    page.getByText("Skip AI categories", { exact: true }),
  ).toHaveCount(0);
  await page.locator("input[type=file]").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Maria Rossi lives in Rome."),
  });
  await page
    .getByRole("button", { name: "Redact document", exact: true })
    .click();
  await expect(page.locator(".file-error")).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("link", { name: "Download document" }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("add AI detection", { exact: true }),
  ).toBeChecked();
});

test("Moduli IT and identifier flags control TXT processing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("add AI detection", { exact: true }).uncheck();
  await expect(page.getByLabel("Moduli IT", { exact: true })).not.toBeChecked();
  await expect(
    page.getByLabel("IBAN bank accounts", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("Apply header redaction to every page", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("Header size (PDF only)", { exact: true }),
  ).toHaveValue("0");
  await page.getByLabel("IBAN bank accounts", { exact: true }).check();
  await page.getByLabel("Moduli IT", { exact: true }).check();
  await page.locator("input[type=file]").setInputFiles({
    name: "accounts.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("BANCA GB82 WEST 1234 5698 7654 32\nRSSMRA80A01H501U"),
  });
  await page
    .getByRole("button", { name: "Redact document", exact: true })
    .click();
  await expect(page.getByLabel("Redacted text document")).toHaveText(
    "BANCA [REDACTED]\n[REDACTED]",
  );
});
