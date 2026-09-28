import { readFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { extractPage } from "../../src/pdf";
import { test, expect } from "@playwright/test";
import { fixture } from "../fixture";

test("PDF debug option logs worker extraction with AI off", async ({
  page,
}) => {
  const logs: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "log") logs.push(message.text());
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Load sample/ }).click();
  await page.getByText("Advanced options", { exact: true }).click();
  const debug = page.getByLabel("Debug: log extracted PDF text", {
    exact: true,
  });
  await expect(debug).not.toBeChecked();
  await debug.check();
  await page
    .getByRole("button", { name: "Redact document", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download document" }),
  ).toBeVisible({ timeout: 30000 });
  expect(
    logs.some(
      (text) =>
        text.includes("[LocalRedact] Extracted PDF text — page 1/") &&
        text.includes("Mario Rossi"),
    ),
  ).toBe(true);
});

test("processes and downloads PDFs entirely locally in the production build", async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Redact sensitive document content",
  );
  await page.getByRole("button", { name: /Load sample/ }).click();
  await expect(
    page.getByText("example-payslip.pdf", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("add AI detection", { exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("button", { name: "Redact document", exact: true })
    .click();
  const download = page.getByRole("link", { name: "Download document" });
  await expect(download).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("img", { name: "Redacted document, page 1" }),
  ).toBeVisible();
  await expect(
    page.getByText("Rules-only result:", { exact: false }),
  ).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await download.click();
  expect((await downloadEvent).suggestedFilename()).toBe(
    "localredact_0001.pdf",
  );
  expect(
    requests.filter(
      (url) =>
        !url.startsWith("http://127.0.0.1:4173/") && !url.startsWith("blob:"),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Clear files" }).click();
  await expect(download).not.toBeVisible();
});

test("AI is an optional addition and text file guidance uses plain language", async ({
  page,
}) => {
  await page.goto("/");
  const ai = page.getByLabel("add AI detection", { exact: true });
  const email = page.getByLabel("Email addresses", { exact: true });
  const italianPack = page.getByLabel("Moduli IT", { exact: true });
  await expect(italianPack).not.toBeChecked();
  await italianPack.check();
  await expect(italianPack).toBeChecked();
  await expect(email).not.toBeChecked();
  await email.check();
  await expect(email).toBeChecked();
  await expect(ai).not.toBeChecked();
  await expect(
    page.getByText("Rules match known patterns and terms you enter.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "OpenAI Privacy Filter" }),
  ).toHaveAttribute("href", "https://huggingface.co/openai/privacy-filter");
  await expect(
    page.getByRole("link", { name: "OpenAI Privacy Filter" }),
  ).toHaveAttribute("target", "_blank");
  await expect(page.locator(".settings-panel .notice")).toHaveCount(0);
  await expect(
    page.getByText("approximately 917 MB", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByText("PDF or text", { exact: true })).toBeVisible();
  await page.getByLabel("Always redact", { exact: true }).fill("Maria");
  await page.getByLabel("IBAN bank accounts", { exact: true }).check();
  await ai.check();
  await expect(
    page.getByRole("note", { name: "AI detection details" }),
  ).toBeVisible();
  await expect(page.getByRole("note").getByRole("listitem")).toHaveCount(4);
  await expect(
    page.getByText("approximately 917 MB", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Runs locally with WebGPU.", {
      exact: false,
    }),
  ).toBeVisible();
  await ai.uncheck();
  await expect(page.getByLabel("Always redact", { exact: true })).toHaveValue(
    "Maria",
  );
  await expect(
    page.getByLabel("IBAN bank accounts", { exact: true }),
  ).toBeChecked();
  await page.locator("input[type=file]").setInputFiles({
    name: "unsupported.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("synthetic"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "Only PDF and text documents can be added.",
  );
});

test("shows a per-file OCR error and continues the batch", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("add AI detection", { exact: true }).uncheck();
  await page.locator("input[type=file]").setInputFiles([
    {
      name: "scanned-page.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(fixture({ secondPage: "image" })),
    },
    {
      name: "searchable.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(fixture()),
    },
  ]);
  await page.getByRole("button", { name: "Redact 2 documents" }).click();
  await expect(page.getByText(/Page 2 has no searchable text/)).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByRole("link", { name: "Download document" }),
  ).toBeVisible();
  await expect(
    page.getByText("localredact_0002.pdf", { exact: true }),
  ).toBeVisible();
});

test("preserves an empty PDF page and allows reviewing the complete output", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Always redact", { exact: true }).fill("Mario Rossi");
  await page.locator("input[type=file]").setInputFiles({
    name: "with-blank-page.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(fixture({ secondPage: "emptyForm" })),
  });
  await page
    .getByRole("button", { name: "Redact document", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download document" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(
    page.getByRole("img", { name: "Redacted document, page 2" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  await expect(page.locator(".file-error")).toHaveCount(0);
});

test("validates configuration before starting", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Load sample/ }).click();
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByLabel("Keep expressions").fill("[");
  await page
    .getByRole("button", { name: "Redact document", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid keep expression",
  );
});

test("AI download failure never falls back to rules-only export", async ({
  page,
  context,
}) => {
  await context.route("https://huggingface.co/**", (route) =>
    route.abort("failed"),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Load sample/ }).click();
  await page.getByLabel("add AI detection", { exact: true }).check();
  await page
    .getByRole("button", { name: "Redact document", exact: true })
    .click();
  await expect(page.locator(".file-error")).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("link", { name: "Download document" }),
  ).not.toBeVisible();
  await expect(
    page.getByLabel("add AI detection", { exact: true }),
  ).toBeChecked();
});

test("cancels model loading and can restart in the explicitly selected rules mode", async ({
  page,
  context,
}) => {
  const releases: (() => void)[] = [];
  await context.route("https://huggingface.co/**", async (route) => {
    await new Promise<void>((resolve) => releases.push(resolve));
    await route.abort().catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Load sample/ }).click();
  await page.getByLabel("add AI detection", { exact: true }).check();
  await page
    .getByRole("button", { name: "Redact document", exact: true })
    .click();
  await expect.poll(() => releases.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Cancel processing" }).click();
  releases.forEach((release) => release());
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await expect(
    page.getByText("Cancelled. You can try again.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download document" }),
  ).not.toBeVisible();
  await page.getByLabel("add AI detection", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Redact document", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download document" }),
  ).toBeVisible();
});

test("PDF header percentage and page selection control the saved output", async ({
  page,
}) => {
  await page.goto("/");
  const header = page.getByLabel("Header size (PDF only)", { exact: true });
  const allPages = page.getByLabel("Apply header redaction to every page", {
    exact: true,
  });
  await expect(header).toBeEnabled();
  await expect(header).toHaveValue("0");
  await expect(allPages).not.toBeChecked();
  await expect(
    page.getByLabel("Redact PDF header text", { exact: true }),
  ).toHaveCount(0);
  for (const [percentage, everyPage] of [
    [18, false],
    [18, true],
    [0, true],
  ] as const) {
    await page.locator("input[type=file]").setInputFiles({
      name: "two-pages.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(fixture({ secondPage: "text" })),
    });
    await header.fill(String(percentage));
    await allPages.setChecked(everyPage);
    await page
      .getByRole("button", { name: "Redact document", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download document" }).click();
    const doc = new mupdf.PDFDocument(
      await readFile((await (await download).path())!),
    );
    try {
      expect(doc.countPages()).toBe(2);
      for (let i = 0; i < 2; i++) {
        const pdfPage = doc.loadPage(i);
        try {
          expect(extractPage(pdfPage).text.includes("ACME")).toBe(
            !(percentage > 0 && (i === 0 || everyPage)),
          );
        } finally {
          pdfPage.destroy();
        }
      }
    } finally {
      doc.destroy();
    }
    await page.getByRole("button", { name: "Clear files" }).click();
  }
});
