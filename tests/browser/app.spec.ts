import { test, expect } from "@playwright/test";
import { fixture } from "../fixture";

test("processes and downloads PDFs entirely locally in the production build", async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Redact sensitive PDF content",
  );
  await page.getByRole("button", { name: /Load sample/ }).click();
  await expect(
    page.getByText("example-payslip.pdf", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Detection", { exact: true })).toHaveValue(
    "rules",
  );
  await page.getByRole("button", { name: "Redact PDF", exact: true }).click();
  const download = page.getByRole("link", { name: "Download PDF" });
  await expect(download).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("img", { name: "Redacted PDF, page 1" }),
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

test("shows a per-file OCR error and continues the batch", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Detection", { exact: true }).selectOption("rules");
  await page.locator("input[type=file]").setInputFiles([
    {
      name: "scanned-page.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(fixture({ blankPage: true })),
    },
    {
      name: "searchable.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(fixture()),
    },
  ]);
  await page.getByRole("button", { name: "Redact 2 PDFs" }).click();
  await expect(page.getByText(/Page 2 has no searchable text/)).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
  await expect(
    page.getByText("localredact_0002.pdf", { exact: true }),
  ).toBeVisible();
});

test("validates configuration before starting", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Load sample/ }).click();
  await page.getByText("Advanced options", { exact: true }).click();
  await page.getByLabel("Keep expressions").fill("[");
  await page.getByRole("button", { name: "Redact PDF", exact: true }).click();
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
  await page.getByLabel("Detection", { exact: true }).selectOption("model");
  await page.getByRole("button", { name: "Redact PDF", exact: true }).click();
  await expect(page.locator(".file-error")).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("link", { name: "Download PDF" }),
  ).not.toBeVisible();
  await expect(page.getByLabel("Detection", { exact: true })).toHaveValue(
    "model",
  );
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
  await page.getByLabel("Detection", { exact: true }).selectOption("model");
  await page.getByRole("button", { name: "Redact PDF", exact: true }).click();
  await expect.poll(() => releases.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Cancel processing" }).click();
  releases.forEach((release) => release());
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await expect(
    page.getByText("Cancelled. You can try again.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download PDF" }),
  ).not.toBeVisible();
  await page.getByLabel("Detection", { exact: true }).selectOption("rules");
  await page.getByRole("button", { name: "Redact PDF", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download PDF" })).toBeVisible();
});
