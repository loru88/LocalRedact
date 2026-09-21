# LocalRedact

LocalRedact is a React + TypeScript + Vite app derived from an Italian payslip
redactor. It supports searchable PDFs and TXT documents and still applies payslip-specific
rules; general document profiles and additional formats are planned. Files are
processed locally in a Web Worker with MuPDF WebAssembly and Transformers.js.
There is no processing backend, upload endpoint, API key, analytics, or account.

See [TODO.md](TODO.md) for the roadmap: text review controls, document profiles, images,
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

Open the localhost URL printed by Vite. Select PDF or TXT documents, configure redaction,
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

## Detection modes

- **AI + payslip rules** (default): downloads `openai/privacy-filter` in q4 format
  on first use, approximately 917 MB of model weights plus tokenizer/runtime
  assets. Requests retrieve public assets from Hugging Face and its CDN and the
  ONNX runtime CDN; document contents are never included. Browser caching is best-effort
  and subject to storage quotas. Model initialization needs more memory than the
  download size. WebGPU requires compatible hardware/browser and HTTPS or
  localhost. AI requires WebGPU: the published quantized models use
  `GatherBlockQuantized`, which the tested browser CPU/WASM runtime does not
  implement. The app checks for a GPU adapter before downloading model weights.
- **Rules only**: no model download, and no automatic general-purpose detection
  of names, addresses, emails, dates, etc. Those details are removed only if a
  header, explicit term, or another payslip rule covers them. This mode is always
  labelled in results. A model failure never silently switches to rules-only.

Documents and generated results are held in memory. **Clear files** revokes result URLs;
reloading closes the processing session. **Cancel processing** terminates the
worker, including an active download/inference. Successful files in a batch remain
available when another file fails. Settings apply to the next processing run;
clear and re-add files to regenerate already completed results.

The app is client-side, but it is not an installable offline PWA: the app must be
served and model assets must be downloaded/cached. There is no service worker.

## TXT handling

- Add `.txt` files on their own or in a batch with PDFs. Word files and pasted-text
  input are not supported yet.
- Input supports UTF-8 (with or without a BOM) and BOM-marked UTF-16 LE/BE. Invalid
  encodings and NUL-containing input stop that file before AI inference; save such
  files as UTF-8 text first. Output is always UTF-8 without a BOM.
- AI detection, explicit terms, keep expressions and existing Italian tax-code,
  IBAN and banking-line rules also apply to TXT. Header removal and automatic
  salary-field protection are PDF-only; the header slider does not affect TXT.
- Matched text is replaced with `[REDACTED]`. Line endings, blank lines and
  surrounding whitespace are preserved. Overlapping detections are merged.
  Keep terms/expressions preserve matching character ranges from AI redaction;
  mandatory rules still override them. All supported AI categories are enabled.
- Preview displays the same redacted text that is downloaded, as literal text
  rather than HTML. Outputs use names such as `localredact_0001.txt`. Empty files
  can be exported unchanged without loading a model.
- Review the entire result before sharing. To correct a missed term, add it to
  **Always redact**, clear and re-add the file, and process it again. There is no
  manual preview editor yet. TXT-only processing does not load the PDF engine.

## Rules and PDF handling

- Italian tax-code and IBAN patterns, bank-information lines, explicit redaction
  terms, and a configurable employer header (18% by default).
- Exact keep terms, JavaScript keep regexes, and automatic
  protection of recognized pay-period and net-pay fields.
- Explicit redact terms, tax codes, IBANs and bank lines override keep rules.
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
- A page with no searchable text stops that file before inference. Run OCR locally
  first. Password-protected PDFs must be decrypted locally first. No OCR or
  password-entry feature is included.

## Differences from the Python CLI

The browser implements the same rule priorities, with these deliberate differences:

1. The browser reads per-token model scores directly and maps the tokenizer's
   reversible byte representation to the original PDF text. The full byte stream
   and token IDs must match before inference. This avoids decoded-string search,
   punctuation cleanup, and grouping across unlabelled text. Repeated terms keep
   their own positions; tokens splitting an accented character or emoji cover the
   entire source character. An inconsistent token stream still stops export.
   Explicit user keep rules still apply. This is not guaranteed to produce
   identical model output to Python.
2. Inference uses overlapping 3,000-character chunks (400-character overlap) to
   bound working memory. Chunk boundaries and q4 quantization may change detections.
3. Each pay-field label gets its own nearby protection area. The original Python
   script joins distant matching labels, potentially protecting unrelated text
   between them. The browser intentionally avoids that behavior.
4. Keep regexes use JavaScript `giu` flags, not Python regex syntax. Case-insensitive
   matching does not implement Python's full Unicode `casefold()` semantics.
5. Textless pages fail the file rather than being passed through with a warning.

Always inspect every output before sharing. Privacy Filter is primarily trained
for English; Italian payslips can produce missed detections or false positives.
Images elsewhere on a searchable page are not OCRed, and unusual PDF layouts can
affect reading order and field protection. This tool does not guarantee anonymity.

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
3. **Apply the selected text detection mode.** Pass the combined text and word
   positions through the existing rules and, in AI mode, Privacy Filter. Rules-only
   mode would support OCR and explicit terms without downloading Privacy Filter.
4. **Scan barcodes and QR codes separately.** Use ZXing-WASM to locate supported
   codes. The proposed default when scanning is enabled is to redact every detected
   code, regardless of whether its decoded value looks sensitive. Associate nearby
   printed digits using OCR, position and decoded content when available, then
   include those digits in the redaction. Do not depend on the employer-header
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
  retain the current rejection of pages without searchable text.
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
  including a visa-like fixture with employer-header redaction disabled.
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
coverage. TXT tests cover Unicode/encodings, replacement, line endings, keep
precedence, overlapping detections and failures. Browser tests run the production
build, real worker, PDF/TXT previews and downloads, mixed batches and responsive
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
- `src/text.ts`: TXT decoding, span replacement and UTF-8 text export.
- `src/detection.ts`: byte-accurate token alignment and per-token AI detections.
- `src/rules.ts`: precedence, keep fields and rectangle merging.
- `tests/`: synthetic fixtures, integration tests and browser smoke tests.

Dependencies: [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js),
[Transformers.js](https://huggingface.co/docs/transformers.js),
[Privacy Filter](https://huggingface.co/openai/privacy-filter).
MuPDF is offered under AGPL-3.0 or a commercial license; review its terms before
redistributing or deploying the application. Privacy Filter's model is Apache-2.0.
