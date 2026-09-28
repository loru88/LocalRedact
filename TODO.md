# LocalRedact roadmap

Planned work toward general document redaction, with all processing kept local
in the browser. Unchecked items are not implemented.

## Clearer disclaimers and model attribution

- [ ] Clearly show the AI model's download size before processing: currently
      approximately 917 MB of q4 weights plus tokenizer/runtime assets. Explain
      first-use download time, additional memory requirements and that browser
      caching is best-effort, so assets may need to be downloaded again.
- [ ] Explain that automatic detection can miss sensitive data or redact the
      wrong content. Include examples such as names, sex, citizenship, birthplace,
      image text and barcodes, with wording that reflects the enabled features.
      Require careful review before sharing and explain how to correct omissions
      using explicit redact terms or manual redaction when available.
- [ ] Prominently state that AI detection is based on OpenAI Privacy Filter and
      link to the model documentation. Distinguish the model from LocalRedact's
      additional rules and PDF processing, and explain that inference runs locally
      and document contents are not sent to OpenAI.

## Say "text" instead of "TXT"

- [x] Use "text document" or "text file" in user-facing copy instead of "TXT"
      (upload prompt, file-type error, header help, result summary, output notes).
      Keep `.txt` where the file extension itself is meant.

Implemented in UI and error messages, README and browser tests. Internal
identifiers such as `format: "txt"` stay as they are.

## Rules as the base, AI as an add-on

- [x] Replace the "Detection" select with "add AI detection".
      Enabled rules, the header option and redact/keep terms always apply;
      the checkbox only adds model spans on top.
- [x] Show a one-line benefit and model link below the checkbox, with concise
      download, WebGPU and limitation bullets in a notice when enabled. Explain
      rules above it and open the model link in a new tab.

AI starts unchecked, so no model download occurs unless requested.
`Options.useAi` controls the additional detections; results record that setting
and label rules-only output. If AI is checked and fails, the file fails; it
never silently falls back.

## Progressive web app

- [ ] Make LocalRedact installable on supported mobile phones, with a home-screen
      icon and a standalone app window.
- [ ] Add a web app manifest, icons and a service worker for installation and the
      intended offline experience.
- [ ] Explain offline limitations, including model downloads and browser cache
      availability. Keep document contents out of persistent caches.

## WebMCP tools for AI agents

- [ ] Expose redaction as WebMCP tools so a browser agent can redact documents
      through the page without driving the UI.

Feasibility: medium, and limited by browser support. WebMCP is a Web Machine
Learning Community Group draft. As of September 2026 only Chrome implements it,
behind `chrome://flags/#enable-webmcp-testing` or an origin trial, on HTTPS.
The API moved from `navigator.modelContext` to `document.modelContext`
(the old name is deprecated in Chromium 150), so it is still changing.
Treat it as progressive enhancement: feature-detect it and register nothing
when it is missing.

High-level approach:

- Register a small set of tools from the app, e.g. `get_redaction_options`,
  `redact_text` (text in, redacted text and found spans out), and
  `redact_files` (process files already queued or added by the user, return
  a summary and make downloads available). Reuse the existing worker path
  and `Options` so agent calls and UI clicks behave the same way.
- Text is the easy case: it can be passed as a tool argument. Binary files
  such as PDFs are harder, because tool arguments are JSON; they would need
  base64 input or a flow where the user picks the file and the agent only
  starts processing. Check what the spec allows before choosing.
- Privacy: tool calls come from an agent that may send the results
  to a remote model. Returning redacted output is fine, but returning the
  original text or detected spans sends sensitive content to the agent, so
  document this clearly and keep detections out of tool results by default.
  Consider requiring user confirmation (if the API provides it) before a tool
  processes a document.
- The AI option still means a 917 MB download and WebGPU; the tool should
  report that instead of hiding it, and fail rather than fall back.
- Add a browser test that stubs `document.modelContext` and calls the tools.

## TXT support

- [x] Accept `.txt` files, including mixed PDF/TXT batches.
- [ ] Add pasted-text input.
- [x] Reuse shared AI detection, explicit redact/keep terms and existing text rules.
- [ ] Let users review, add and remove detections before export.
- [x] Replace detected sensitive text with `[REDACTED]` and export a fresh UTF-8
      `.txt` file, preserving line breaks and handling Unicode and input encodings.
      Input supports UTF-8 and BOM-marked UTF-16; unsupported encodings fail explicitly.

## Optional detection rules

- [x] Add an optional email rule that includes generic mailboxes independently of AI.
- [x] Add an optional Modello 730 date rule for valid day/month/year values on
      three consecutive lines immediately after `GIORNO MESE ANNO`.
- [x] Group Italian rules for Modello 730 and payslip forms under the single
      Moduli IT setting.
- [ ] Reconstruct birth dates split across PDF fields using layout and label context,
      retaining original offsets for redaction. Avoid joining unrelated numeric fields.
- [x] Make processing general-purpose by default, with header removal off and
      Italian form handling opt-in through Moduli IT. No banking-line rules run
      automatically.
- [x] Add independent opt-in flags for Italian fiscal codes and international
      IBANs, with shared redact/keep precedence.
- [x] Enable PDF header redaction above 0%, defaulting to the first page with an
      option to apply it to every page.
- [x] Use an extensible identifier-rule registry shared by PDF, TXT and the UI.
- [x] Add regression coverage for flags, international IBANs and header images.
- [ ] Show the exact enabled rules used for each completed result.

## Image support, OCR, barcodes and QR codes

- [ ] Accept standalone PNG/JPEG images and scan image content in PDFs, including
      searchable pages with embedded images and pages containing only scans.
- [ ] Use Tesseract.js for OCR text and word positions, initially with Italian
      and English language data; map rotated/scaled coordinates back correctly.
- [ ] Merge OCR with native PDF text without duplicating words, then run the
      selected detection mode and explicit rules.
- [ ] Use ZXing-WASM for supported barcode/QR formats and redact detected codes
      together with associated printed digits, independently of header settings.
- [ ] Permanently remove selected pixels and vector barcode graphics; produce
      fresh image outputs without original metadata and verify PDF exports too.
- [ ] Add manual rectangle selection for missed details, photos and signatures.
- [ ] Provide scan progress, cancellation and clear errors; limit memory use and
      never silently treat a failed scan as successful.

See the [image-scanning proposal in README.md](README.md#potential-feature-scan-image-text-barcodes-and-qr-codes)
for the proposed pipeline and acceptance checks.

## Word support

- [ ] Support modern `.docx` files; initially direct legacy `.doc` users to save
      as `.docx` or PDF locally.
- [ ] Extract structured text, including supported tables, headers, footers,
      notes and text boxes; detect sensitive text split across formatting runs.
- [ ] Generate a fresh sanitized `.docx`, preserving supported basic formatting
      and clearly reporting unsupported content or layout changes.
- [ ] Exclude original metadata, comments, revision history and embedded files;
      handle hyperlink destinations as well as visible text.
- [ ] Remove embedded images or scan and review them before retaining them.
- [ ] Verify exported document parts contain no surviving copies of targeted
      sensitive content; do not rely on visual black boxes or font colors.

## Multi-page PDF support

Basic multi-page processing and saved-output page navigation already exist.
The remaining work is to strengthen review, coverage and handling of larger files.

- [ ] Add per-page detection summaries and review status, with manual corrections
      applied to the correct page before final export.
- [ ] Support mixed searchable/scanned pages through the OCR pipeline.
- [ ] Improve progress, cancellation and memory management for long documents,
      including avoiding unnecessary full-document preview images in memory.
- [ ] Expand tests for detections on every page, repeated identifiers, rotated
      pages, different page sizes and failures on later pages.
- [ ] Verify all exported pages retain their order and intended layout, with no
      unprocessed pages silently passed through as successfully redacted.
