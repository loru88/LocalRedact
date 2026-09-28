# LocalRedact

LocalRedact is a React + TypeScript + Vite app for searchable PDFs and text documents.
It combines optional AI detection, explicit terms and independently enabled rules. Files are
processed locally in a Web Worker with MuPDF WebAssembly and Transformers.js.
There is no processing backend, upload endpoint, API key, analytics, or account.

See [TODO.md](TODO.md) for the roadmap: text review controls, images,
Word and expanded multi-page PDF support.

This README is the shared guide for humans and agents. [AGENTS.md](AGENTS.md)
adds a concise code map, development conventions and implementation invariants.

## Run

Use Node.js 22.12+ (or a newer supported Node release).

```sh
# From the LocalRedact repository root:
npm ci
npm run dev
```

Open the localhost URL printed by Vite. Select PDF or text documents, configure redaction,
click **Redact document**, review the output, and download it. **Load sample** adds
a synthetic document and selects rules-only mode, so you can try the PDF pipeline
without downloading a model. The original Python project is maintained separately.

```sh
npm run build
npm run preview
```

Deploy `dist/` to any static HTTPS host. Relative asset paths also support hosting
in a subfolder. Do not open `index.html` using `file://`; workers and model loading
need HTTP(S). No server-side application runtime is required.

## Rules and optional AI

Enabled rules, the PDF header option and redact/keep terms apply whether AI is
enabled or not. **add AI detection** is unchecked by default.

- **Rules only** (default): no model download, and no automatic general-purpose
  detection of names, addresses, emails, dates, etc. Those details are removed
  only if an enabled rule, optional PDF header, or explicit term covers them.
  Results are labelled “rules only”; other personal information may remain.
- **add AI detection**: adds model detections to the selected rules.
  Downloads `openai/privacy-filter` in q4 format on first use, approximately
  917 MB of model weights plus tokenizer/runtime assets. Requests retrieve public
  assets from Hugging Face and its CDN and the ONNX runtime CDN; document contents
  are never included. Browser caching is best-effort and subject to storage
  quotas. Model initialization needs more memory than the download size.
  AI requires compatible hardware/browser with WebGPU and HTTPS or localhost:
  the published quantized models use `GatherBlockQuantized`, which the tested
  browser CPU/WASM runtime does not implement. The app checks for a GPU adapter
  before downloading model weights. If AI fails, the file fails; the app never
  silently switches to rules only.

Documents and generated results are held in memory. **Clear files** revokes result URLs;
reloading closes the processing session. **Cancel processing** terminates the
worker, including an active download/inference. Successful files in a batch remain
available when another file fails. Settings apply to the next processing run;
clear and re-add files to regenerate already completed results.

The app is client-side, but it is not an installable offline PWA: the app must be
served and model assets must be downloaded/cached. There is no service worker.

## Text handling

- Add `.txt` files on their own or in a batch with PDFs. Word files and pasted-text
  input are not supported yet.
- Input supports UTF-8 (with or without a BOM) and BOM-marked UTF-16 LE/BE. Invalid
  encodings and NUL-containing input stop that file before AI inference; save such
  files as UTF-8 text first. Output is always UTF-8 without a BOM.
- AI detection, explicit terms, keep expressions and enabled identifier rules
  apply to text files. The optional PDF header setting does not affect text files.
- Matched text is replaced with `[REDACTED]`. Line endings, blank lines and
  surrounding whitespace are preserved. Overlapping detections are merged.
  Keep terms/expressions preserve matching character ranges from AI redaction;
  mandatory rules still override them. All supported AI categories are enabled.
- Preview displays the same redacted text that is downloaded, as literal text
  rather than HTML. Outputs use names such as `localredact_0001.txt`. Empty files
  can be exported unchanged without loading a model.
- Review the entire result before sharing. To correct a missed term, add it to
  **Always redact**, clear and re-add the file, and process it again. There is no
  manual preview editor yet. Text-only processing does not load the PDF engine.

## Rules and PDF handling

- Identifier rules and PDF header removal are independently enabled and **off by
  default**, with or without AI. There are no automatic banking-line rules.
- **Moduli IT pack**: provides special handling for Modello 730 forms and
  Italian payslips.
- **IBAN bank accounts**: matches compact or space-separated international IBANs
  (case-insensitively, including nonbreaking spaces) using a modulo-97 checksum.
  Country-specific lengths and account existence are not validated. Invalid
  checksums and IBANs split across lines are not matched; use explicit terms for
  these cases. Only the matched number is selected, not the surrounding bank line.
  National formats are documented in the [SWIFT IBAN registry](https://www.swift.com/standards/data-standards/iban-international-bank-account-number).
- **Email addresses**: optional rule for common email patterns, including generic
  mailboxes such as `info@example.com`, regardless of AI predictions. Off by default;
  overrides keep rules when enabled. Does not cover quoted local parts,
  internationalized addresses or addresses split across lines.
- **Header size (PDF only)**: starts at 0% (off). Set it above zero to remove
  text in the top portion of the first page of each PDF. Select **Apply header
  redaction to every page** to include subsequent pages. Images are not selected
  by this rule; pixels underneath text redaction rectangles may still be removed.
- Exact keep terms and JavaScript keep regexes override AI/header text matches.
  Explicit redact terms and enabled identifier rules override keep rules.
- To add an identifier flag, add an entry to `src/identifierRules.ts` with a stable
  ID, label, description and detector returning UTF-16 spans. The UI and both
  document processors use that registry. `Options.enabledRules` selects its IDs;
  `Options.headerFraction` sets the header size and `Options.headerAllPages`
  extends header text removal beyond the first page. Unknown rule IDs are rejected.
- Word coordinates are extracted from MuPDF character quads. A one-point margin
  is added and neighboring rectangles on the same line are joined.
- Redactions remove covered text and image pixels rather than drawing a reversible
  overlay. Vector line art is currently preserved, so vector barcodes or sensitive
  content drawn as shapes require additional handling.
- Output is a fresh PDF of the redacted pages with standard/XML metadata removed.
  Original annotations, attachments, outlines and document-level extras are not
  copied. Interactive forms must be flattened locally before processing.
- Outputs use neutral names such as `localredact_0001.pdf`. Previews render the actual
  saved PDF, rather than a simulated overlay.
- A nonblank page with no searchable text stops that file before inference. Run
  OCR locally first. Empty pages are preserved as fresh blank pages without
  inference. Password-protected PDFs must be decrypted locally first. No OCR or
  password-entry feature is included.

## Detection details

Under **Advanced options**, **Debug: log extracted PDF text** logs each searchable
page's original extracted text to the browser console before AI chunking and
detection or redaction. It is off by default and also works with AI disabled.
These local console logs can contain personal data; clear them after debugging.
Text files are not logged.

Per-token model scores are mapped through the tokenizer's reversible byte
representation to the original text. The complete byte stream and token IDs must
match before inference. Repeated terms retain their own positions, and tokens
splitting an accented character or emoji cover the entire source character.
An inconsistent token stream stops export.

Inference uses overlapping 3,000-character chunks (400-character overlap) to bound
working memory. Chunk boundaries and q4 quantization may affect detections.
Keep regexes use JavaScript `giu` flags, not Python regex syntax.

Always inspect every output before sharing. Privacy Filter is primarily trained
for English; non-English documents can produce missed detections or false positives.
Images on searchable pages are not OCRed, and unusual PDF layouts can affect
reading order. This tool does not guarantee anonymity.

## Potential feature: scan image text, barcodes and QR codes

**Proposal only — not implemented.** Add an optional **Scan images and barcodes**
setting that works entirely in the browser. This would extend detection to text
inside images on otherwise searchable pages and allow scanned PDFs to be processed.
Use [Tesseract.js](https://github.com/naptha/tesseract.js) for OCR,
[ZXing-WASM](https://github.com/Sec-ant/zxing-wasm) for supported barcode/QR formats,
and the existing MuPDF pipeline for permanent redaction.

### Proposed processing flow

1. **Render pages with MuPDF.** Produce higher-resolution page images for scanning,
   including pages that already have selectable text. Scanning the rendered page
   also exposes barcodes drawn as vector shapes, rather than embedded images.
2. **Recognize image text with Tesseract.js.** Request word bounding boxes as well
   as text. Retain native PDF text where available and merge OCR words without
   duplicating text at the same location. Start with Italian and English language
   data. Preserve the rendering and rotation transforms so OCR coordinates map
   accurately back to PDF coordinates.
3. **Apply the selected text detection settings.** Pass the combined text and word
   positions through the existing rules and, with AI enabled, Privacy Filter. Rules-only
   mode would support OCR and explicit terms without downloading Privacy Filter.
4. **Scan barcodes and QR codes separately.** Use ZXing-WASM to locate supported
   codes. The proposed default when scanning is enabled is to redact every detected
   code, regardless of whether its decoded value looks sensitive. Associate nearby
   printed digits using OCR, position and decoded content when available, then
   include those digits in the redaction. Do not depend on the PDF header
   setting to cover codes elsewhere on the page.
5. **Apply permanent redactions with MuPDF.** Merge detection rectangles and remove
   covered text, image pixels and vector barcode graphics. Audit the line-art
   redaction settings as part of implementation. An OCR text layer or black overlay
   alone does not remove the original sensitive content. Continue producing a fresh
   PDF with stripped metadata and previews rendered from the saved output.

### Browser behavior and limitations

- Keep scanning opt-in; download OCR language/runtime assets only when needed.
  Documents and recognized text stay local. Show download, OCR and barcode-scan
  progress, reuse workers, and process pages sequentially to limit memory use.
- Preserve cancellation and per-file error handling. An OCR or scanner failure
  must not silently export a file as successfully scanned. Without scanning enabled,
  retain the rejection of nonblank pages without searchable text.
- OCR can misread or miss text, and barcode readers can miss damaged or unsupported
  codes. No detections does not prove that a page contains no sensitive information.
  OCR also does not expand Privacy Filter's categories: fields such as sex,
  citizenship and birthplace still need explicit terms or document-field rules.
- Include a review step with manual rectangle selection for missed text, codes,
  photos and signatures. Automatic photo/signature detection is outside this
  proposal. Users must still inspect every page before sharing.

### Acceptance checks before release

- Use synthetic fixtures for image-only pages, mixed native/image text, Italian
  accents, rotated/cropped pages, and small or low-quality text. Verify coordinate
  mapping, duplicate suppression and existing keep/redact priorities.
- Cover raster and vector barcodes, QR codes, and printed digits beside codes,
  including a visa-like fixture with PDF header redaction disabled.
- Reopen exported PDFs and inspect text, rendered pages and embedded images to
  confirm the targeted content was removed. Check that covered codes no longer
  decode; a decoder failure alone is not proof of permanent removal.
- Exercise rules-only and AI modes, language downloads, scanner failures,
  cancellation, multi-page memory use and manual corrections in browser tests.

## Verification

```sh
npm test
npx playwright install chromium
npm run build
npm run test:browser
```

Minimal Linux installations may also need Playwright's system browser libraries
(`npx playwright install-deps chromium`).

Unit/integration tests exercise the real MuPDF engine with synthetic PDFs: text
removal after reopening, metadata/attachment stripping, keep precedence, rotated
pages, input preservation, failure handling, Unicode span alignment and chunk
coverage. Text tests cover Unicode/encodings, replacement, line endings, keep
precedence, overlapping detections and failures. Browser tests run the production
build, real worker, PDF/text previews and downloads, mixed batches and responsive
layout. Tests do not upload personal documents or
download model weights. A live AI run must be checked separately on target hardware.

An opt-in test downloads the real model and verifies name removal on a synthetic
payslip using WebGPU:

```sh
PAYSLIP_LIVE_AI=1 npm run test:browser -- --grep 'live AI'
# To use a native GPU instead of the test suite's headless software adapter:
PAYSLIP_LIVE_AI=1 PAYSLIP_NATIVE_GPU=1 npm run test:browser -- --grep 'live AI'
```

## Source map

- `src/App.tsx`: file queue, options, worker lifecycle, result previews/downloads.
- `src/processor.worker.ts`: model loading, progress, inference and orchestration.
- `src/pdf.ts`: text/coordinate extraction, permanent redaction and PDF export.
- `src/text.ts`: text decoding, span replacement and UTF-8 text export.
- `src/detection.ts`: byte-accurate token alignment and per-token AI detections.
- `src/rules.ts`: shared precedence, optional header text and rectangle merging.
- `src/identifierRules.ts`: registry of optional identifier detectors and UI labels.
- `tests/`: synthetic fixtures, integration tests and browser smoke tests.

Dependencies: [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js),
[Transformers.js](https://huggingface.co/docs/transformers.js),
[Privacy Filter](https://huggingface.co/openai/privacy-filter).
MuPDF is offered under AGPL-3.0 or a commercial license; review its terms before
redistributing or deploying the application. Privacy Filter's model is Apache-2.0.
