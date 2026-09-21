import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as mupdf from "mupdf";
import { fixture } from "../fixture";

// Explicit opt-in: this fetches roughly 917 MB and runs actual inference.
test("live AI redacts a name without an explicit term", async ({ page }) => {
  test.skip(
    process.env.PAYSLIP_LIVE_AI !== "1",
    "Set PAYSLIP_LIVE_AI=1 to download and exercise the real model.",
  );
  test.setTimeout(600_000);
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(fixture()),
  });
  await page.getByRole("button", { name: "Redact PDF", exact: true }).click();
  // Stop promptly on application errors instead of waiting out the download timeout.
  const progress = setInterval(() => {
    void page
      .locator('[role="status"]')
      .textContent({ timeout: 1000 })
      .then((message) => console.log("AI test:", message))
      .catch(() => {});
  }, 20_000);
  try {
    await expect(page.locator("a.download, .file-error")).toBeVisible({
      timeout: 550_000,
    });
  } finally {
    clearInterval(progress);
  }
  expect(
    await page.locator(".file-error").count(),
    await page.locator(".file-list").innerText(),
  ).toBe(0);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download PDF" }).click();
  const download = await downloadEvent;
  const data = await readFile((await download.path())!);
  const doc = new mupdf.PDFDocument(data);
  const pdfPage = doc.loadPage(0);
  const structured = pdfPage.toStructuredText("");
  try {
    expect(structured.asText()).not.toContain("Mario");
    expect(structured.asText()).not.toContain("Rossi");
    expect(structured.asText()).toContain("1.950,00");
  } finally {
    structured.destroy();
    pdfPage.destroy();
    doc.destroy();
  }
});
