# LocalRedact: agent guide

## Start here

- Read [README.md](README.md) for setup, current behavior, limitations and testing.
  It is shared documentation for humans and agents, not just a marketing page.
- Read [TODO.md](TODO.md) for planned features. Roadmap entries are not implemented
  capabilities or instructions to implement them without a corresponding task.
- This directory is the standalone LocalRedact repository root. In some checkouts
  it lives inside an older Python project's `frontend/` directory. Run npm and Git
  commands here; do not include parent directories or personal documents.
- When committing, use the repository-local identity `loru88 <loru88@gmail.com>`
  for both author and committer. Do not change the user's global Git identity.

## Current product

LocalRedact is a React + TypeScript + Vite application. Documents are processed in
browser memory using Web Workers, MuPDF WASM and Transformers.js. There is no
processing backend, upload endpoint, account or analytics. Static HTTPS hosting
is sufficient; Vite's relative base supports deployment under a subfolder.

Supported today: searchable PDFs, multiple pages, batches, rules-only processing,
optional AI detection, saved-output previews and permanent PDF redactions.
Italian payslip rules still apply by default, including the 18% header and salary
field protection. General profiles, TXT, Word, OCR, barcode detection, standalone
images and manual redaction controls remain planned features.

AI uses `openai/privacy-filter` with q4 weights, approximately 917 MB plus runtime
and tokenizer assets. In the tested implementation it requires WebGPU; the
quantized model cannot use the tested CPU/WASM backend. Rules-only mode is an
explicit user choice. The model detects text spans, not PDF geometry or images,
and can miss personal information. Do not promise complete anonymization.

## Code map and processing flow

| File                      | Responsibility                                                                  |
| ------------------------- | ------------------------------------------------------------------------------- |
| `src/App.tsx`             | File queue, settings, worker lifecycle, cancellation, preview and download URLs |
| `src/processor.worker.ts` | Lazy dependencies, GPU check, model loading, chunked inference and progress     |
| `src/detection.ts`        | Byte-level token alignment and per-token model predictions                      |
| `src/pdf.ts`              | PDF preflight, word coordinates, redaction, fresh output and saved-PDF previews |
| `src/rules.ts`            | Explicit terms, payslip rules, keep precedence, rectangles and text chunking    |
| `src/types.ts`            | Options/defaults, categories, spans, rectangles and worker messages             |
| `tests/`                  | Synthetic PDF fixtures, unit/integration tests and Playwright browser tests     |

Flow: file bytes → PDF preflight → extracted text/word coordinates → rules and
optional AI spans → redaction rectangles → content removal → fresh PDF → preview
of the saved artifact. AI input uses overlapping 3,000-character chunks with
400-character overlap. Text offsets are JavaScript UTF-16 indexes.

## Invariants and implementation traps

- Keep document contents, extracted text and previews local. Network requests may
  retrieve public model/runtime assets; they must not carry document data. Use
  synthetic fixtures in tests and never commit private PDFs, credentials or logs.
- Preserve byte-exact token/source alignment and token-ID validation. Do not replace
  them with decoded-string searches, fuzzy matching or silent truncation. Unicode
  characters split across model tokens must map back to complete characters.
- Fail the file on model/alignment errors; never silently fall back to rules-only
  or export a partially processed file as successful. A failed file must not prevent
  other files in the batch from completing.
- Register the worker message handler before asynchronous MuPDF initialization.
  A static import previously caused the first processing message to be lost.
- Explicit redact terms, tax codes, IBANs and bank lines override keep rules.
  Keep terms/regexes and salary-field protection can override AI/header matches.
  Keep each salary-field protection area separate; merging distant labels can
  accidentally protect unrelated sensitive text.
- Redactions must remove underlying content, not merely draw overlays. Current
  MuPDF settings remove covered text/image pixels but preserve vector line art
  (`REDACT_LINE_ART_NONE`). Account for that limitation when changing image or
  barcode handling.
- Preserve fresh-document export and metadata stripping. Original annotations,
  attachments and document-level extras are not copied. Password-protected PDFs,
  interactive forms and pages with no searchable text currently stop processing.
- Explicitly destroy MuPDF objects/dispose tensors and release Blob URLs when no
  longer needed. Cancellation terminates the worker. Completed files currently
  need to be cleared and re-added to apply changed settings.
- Keep UI claims, README and TODO consistent with the implementation. Mention
  model download requirements and detection limitations where users need them.

## Development and verification

Use Node.js 22.12+ and the committed npm lockfile. Run from this repository root:

```sh
npm ci
npm run dev
npm test
npm run build
npm run test:browser
```

Build before browser tests: Playwright starts `vite preview` on port 4173 and uses
the existing `dist/`; it does not build automatically or reuse a running server.
Install its browser with `npx playwright install chromium`. On minimal Linux/WSL,
missing libraries such as `libnspr4.so` require `npx playwright install-deps chromium`.
The test browser uses a software GPU adapter by default.

Ordinary tests use synthetic data and do not download model weights. Optional
checks use the existing `PAYSLIP_*` environment-variable names; see README and
`tests/detection.test.ts` for details. `PAYSLIP_LIVE_AI=1` enables the large model
download/inference test; `PAYSLIP_NATIVE_GPU=1` selects the native test GPU.

For processing changes, test real exported content after reopening it, rule
precedence, Unicode alignment and error handling. For UI/worker changes, run the
relevant browser tests. For documentation-only changes, formatting and
`git diff --check` suffice. Format only touched files with Prettier;
`npm run format` rewrites a broader set of project files.

## Writing style

Use plain english that goes straight to the point.
It's a plain old open source project, there is no need to sell anything.
Do not use marketing peach, tag line and any other salesy language.