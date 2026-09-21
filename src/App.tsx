import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_OPTIONS,
  type DocumentFormat,
  type Options,
  type ProcessRequest,
  type WorkerResponse,
} from "./types";
import { validateOptions } from "./rules";

type Result = Extract<WorkerResponse, { type: "result" }>;
type Job = {
  id: string;
  file: File;
  status: "ready" | "processing" | "done" | "error" | "cancelled";
  message?: string;
  url?: string;
  previews?: string[];
  textPreview?: string;
  format?: DocumentFormat;
  outputName?: string;
  marks?: number;
  pages?: number;
  mode?: Options["mode"];
};
const lines = (text: string) =>
  text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const sizes = (bytes: number) =>
  bytes < 1e6
    ? `${Math.max(1, Math.round(bytes / 1000))} KB`
    : `${(bytes / 1e6).toFixed(1)} MB`;

function Icon({
  kind,
  size = 20,
}: {
  kind: "shield" | "file" | "upload" | "arrow" | "download" | "check";
  size?: number;
}) {
  const paths = {
    shield: (
      <>
        <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H5v18h14V8l-5-5Z" />
        <path d="M14 3v6h5M8 13h8M8 17h5" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    download: <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" />,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({
    message: "",
    fraction: undefined as number | undefined,
  });
  const [selected, setSelected] = useState<string>();
  const [page, setPage] = useState(0);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null);
  const pending = useRef<{
    id: string;
    resolve: (r: Result) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const generation = useRef(0);
  const active = useRef(false);
  const urls = useRef(new Set<string>());
  useEffect(
    () => () => {
      generation.current++;
      worker.current?.terminate();
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  const patch = (id: string, changes: Partial<Job>) =>
    setJobs((items) =>
      items.map((j) => (j.id === id ? { ...j, ...changes } : j)),
    );
  const blobUrl = (bytes: ArrayBuffer, type: string) => {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    urls.current.add(url);
    return url;
  };

  function addFiles(files: File[]) {
    if (active.current) return;
    const accepted = files.filter((f) => /\.(pdf|txt)$/i.test(f.name));
    setError(
      accepted.length !== files.length
        ? "Only PDF and TXT documents can be added."
        : "",
    );
    setJobs((old) => [
      ...old,
      ...accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "ready" as const,
      })),
    ]);
  }
  function getWorker() {
    if (!worker.current) {
      const instance = new Worker(
        new URL("./processor.worker.ts", import.meta.url),
        { type: "module" },
      );
      instance.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.id !== pending.current?.id) return;
        if (data.type === "progress")
          setProgress({ message: data.message, fraction: data.fraction });
        else {
          const request = pending.current;
          pending.current = null;
          if (data.type === "error") request.reject(new Error(data.message));
          else request.resolve(data);
        }
      };
      instance.onerror = () => {
        pending.current?.reject(
          new Error(
            "Document processing stopped unexpectedly. Retry processing or use a smaller file.",
          ),
        );
        pending.current = null;
        instance.terminate();
        worker.current = null;
      };
      worker.current = instance;
    }
    return worker.current;
  }
  async function start() {
    if (active.current) return;
    try {
      validateOptions(options);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const queue = jobs.filter((j) => j.status !== "done");
    if (!queue.length) return;
    active.current = true;
    setRunning(true);
    setError("");
    const run = ++generation.current;
    try {
      for (const job of queue) {
        if (run !== generation.current) break;
        patch(job.id, { status: "processing", message: undefined });
        setProgress({ message: "Reading document…", fraction: undefined });
        try {
          const bytes = await job.file.arrayBuffer();
          if (run !== generation.current) break;
          const result = await new Promise<Result>((resolve, reject) => {
            pending.current = { id: job.id, resolve, reject };
            const message: ProcessRequest = {
              type: "process",
              id: job.id,
              bytes,
              format: /\.txt$/i.test(job.file.name) ? "txt" : "pdf",
              options,
            };
            getWorker().postMessage(message, [bytes]);
          });
          if (run !== generation.current) break;
          const index = jobs.findIndex((j) => j.id === job.id) + 1;
          patch(job.id, {
            status: "done",
            url: blobUrl(
              result.bytes,
              result.format === "pdf"
                ? "application/pdf"
                : "text/plain;charset=utf-8",
            ),
            format: result.format,
            previews:
              result.format === "pdf"
                ? result.previews.map((p) => blobUrl(p, "image/png"))
                : undefined,
            textPreview: result.format === "txt" ? result.text : undefined,
            marks: result.marks,
            pages: result.format === "pdf" ? result.pages : undefined,
            outputName: `${options.prefix}_${String(index).padStart(4, "0")}.${result.format}`,
            mode: options.mode,
          });
          setSelected(job.id);
          setPage(0);
        } catch (e) {
          if (run !== generation.current) break;
          patch(job.id, {
            status: "error",
            message:
              e instanceof Error
                ? e.message
                : "Unable to process this document.",
          });
        }
      }
    } finally {
      if (run === generation.current) {
        active.current = false;
        setRunning(false);
        setProgress({ message: "", fraction: undefined });
      }
    }
  }
  function cancel() {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    pending.current?.reject(new Error("Cancelled"));
    pending.current = null;
    active.current = false;
    setRunning(false);
    setJobs((old) =>
      old.map((j) =>
        ["ready", "processing"].includes(j.status)
          ? {
              ...j,
              status: "cancelled",
              message: "Cancelled. You can try again.",
            }
          : j,
      ),
    );
    setProgress({ message: "", fraction: undefined });
  }
  function clear() {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
    setJobs([]);
    setSelected(undefined);
    setPage(0);
    setError("");
  }
  async function sample() {
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}sample-payslip.pdf`,
      );
      if (!response.ok) throw new Error("Could not load the sample PDF.");
      addFiles([
        new File([await response.arrayBuffer()], "example-payslip.pdf", {
          type: "application/pdf",
        }),
      ]);
      setOptions((old) => ({
        ...old,
        mode: "rules",
        redactTerms: [...new Set([...old.redactTerms, "Mario Rossi"])],
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const chosen = jobs.find((j) => j.id === selected);
  const completed = jobs.filter((j) => j.status === "done").length;
  const ready = jobs.filter((j) => j.status !== "done").length;
  const update = <K extends keyof Options>(key: K, value: Options[K]) =>
    setOptions((old) => ({ ...old, [key]: value }));

  return (
    <>
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <span className="brand-icon">
            <Icon kind="shield" />
          </span>
          LocalRedact<span className="brand-dot">.</span>
        </a>
        <span className="local-badge">
          <span /> Processed on your device
        </span>
      </header>
      <main>
        <section className="intro">
          <div className="eyebrow">DOCUMENT REDACTION</div>
          <h1>Redact sensitive document content</h1>
          <p>
            Select PDF or TXT documents, configure redaction, and review the
            output. PDFs must contain searchable text. Italian payslip text
            rules currently apply to both formats.
          </p>
        </section>

        <div className="workspace">
          <div className="main-column">
            <section className="panel files-panel">
              <div className="section-heading">
                <div>
                  <span className="step">01</span>
                  <h2>Add documents</h2>
                </div>
                <span className="muted">PDF or TXT</span>
              </div>
              <button
                className={`dropzone ${dragging ? "dragging" : ""}`}
                disabled={running}
                onClick={() => input.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!running) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  addFiles(Array.from(e.dataTransfer.files));
                }}
              >
                <span className="upload-icon">
                  <Icon kind="upload" size={25} />
                </span>
                <strong>Drop documents here</strong>
                <span>
                  or <u>browse files</u> on your device
                </span>
                <small>
                  Select one or more PDF or TXT documents. Files are not
                  uploaded.
                </small>
              </button>
              <input
                ref={input}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
              {!jobs.length && (
                <div className="sample-line">
                  Example document:{" "}
                  <button className="text-button" onClick={sample}>
                    Load sample (rules only) <span aria-hidden="true">↗</span>
                  </button>
                </div>
              )}
              {!!jobs.length && (
                <div className="file-list">
                  <div className="list-heading">
                    <span>
                      {jobs.length} document{jobs.length !== 1 ? "s" : ""} ·{" "}
                      {completed} ready to review
                    </span>
                    <button
                      className="text-button"
                      disabled={running}
                      onClick={clear}
                    >
                      Clear files
                    </button>
                  </div>
                  {jobs.map((job) => (
                    <div
                      key={job.id}
                      className={`file-row ${job.status === "error" ? "file-error" : ""}`}
                    >
                      <div className="file-icon">
                        <Icon kind={job.status === "done" ? "check" : "file"} />
                      </div>
                      <div className="file-info">
                        <strong>{job.file.name}</strong>
                        <span>
                          {sizes(job.file.size)} ·{" "}
                          {job.status === "done"
                            ? `${job.format === "pdf" ? `${job.pages} page${job.pages === 1 ? "" : "s"}` : "Text document"} · ${job.marks} redactions${job.mode === "rules" ? " · rules only" : ""}`
                            : job.status === "processing"
                              ? "Processing locally…"
                              : job.status === "ready"
                                ? "Ready to process"
                                : job.message}
                        </span>
                      </div>
                      {job.status === "done" && (
                        <button
                          className="small-button"
                          onClick={() => {
                            setSelected(job.id);
                            setPage(0);
                          }}
                        >
                          Review
                        </button>
                      )}
                      {job.status === "processing" && (
                        <span className="spinner" aria-label="Processing" />
                      )}
                    </div>
                  ))}
                </div>
              )}
              {error && (
                <p className="error-message" role="alert">
                  {error}
                </p>
              )}
              {running && (
                <div className="progress-area" role="status">
                  <span>{progress.message}</span>
                  <progress
                    value={progress.fraction}
                    max={1}
                    aria-label="Processing progress"
                  />
                </div>
              )}
              <div className="action-row">
                <span>
                  {options.mode === "model"
                    ? "AI detection + payslip rules"
                    : "Payslip rules only · AI is off"}
                </span>
                {running ? (
                  <button className="secondary-button" onClick={cancel}>
                    Cancel processing
                  </button>
                ) : (
                  <button
                    className="primary-button"
                    disabled={!ready}
                    onClick={start}
                  >
                    Redact {ready > 1 ? `${ready} documents` : "document"}{" "}
                    <Icon kind="arrow" size={18} />
                  </button>
                )}
              </div>
            </section>

            <section className="panel preview-panel">
              <div className="section-heading">
                <div>
                  <span className="step">03</span>
                  <h2>Review & download</h2>
                </div>
                {chosen?.url && (
                  <a
                    className="small-button download"
                    href={chosen.url}
                    download={chosen.outputName}
                  >
                    <Icon kind="download" size={16} />
                    Download document
                  </a>
                )}
              </div>
              {chosen?.url ? (
                <>
                  <div className="preview-toolbar">
                    <span>{chosen.outputName}</span>
                    {chosen.previews && (
                      <div>
                        <button
                          aria-label="Previous page"
                          disabled={page === 0}
                          onClick={() => setPage((p) => p - 1)}
                        >
                          ←
                        </button>
                        <span>
                          {page + 1} / {chosen.previews.length}
                        </span>
                        <button
                          aria-label="Next page"
                          disabled={page >= chosen.previews.length - 1}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          →
                        </button>
                      </div>
                    )}
                  </div>
                  {chosen.mode === "rules" && (
                    <p className="notice">
                      Rules-only result: text is removed where a payslip rule or
                      an explicit term matches. Names and addresses may remain.
                    </p>
                  )}
                  {chosen.previews ? (
                    <div className="preview-canvas">
                      <img
                        src={chosen.previews[page]}
                        alt={`Redacted document, page ${page + 1}`}
                      />
                    </div>
                  ) : (
                    <pre
                      className="text-preview"
                      aria-label="Redacted text document"
                    >
                      {chosen.textPreview}
                    </pre>
                  )}
                  <p className="review-note">
                    Review the entire document before sharing. Automatic
                    detection can miss personal details, especially in Italian
                    text. This preview shows the saved document.
                  </p>
                </>
              ) : (
                <div className="empty-preview">
                  <div className="paper-illustration" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <i />
                    <span />
                    <i />
                    <span />
                  </div>
                  <h3>No output to preview</h3>
                  <p>
                    Process a document to see the output here.
                    <br />
                    Review the output before downloading.
                  </p>
                </div>
              )}
            </section>
          </div>

          <aside className="panel settings-panel">
            <div className="section-heading">
              <div>
                <span className="step">02</span>
                <h2>Redaction settings</h2>
              </div>
            </div>
            <fieldset disabled={running}>
              <label className="field-label" htmlFor="mode">
                Detection
              </label>
              <select
                id="mode"
                value={options.mode}
                onChange={(e) =>
                  update("mode", e.target.value as Options["mode"])
                }
              >
                <option value="model">AI + payslip rules</option>
                <option value="rules">Rules only (no model download)</option>
              </select>
              {options.mode === "model" ? (
                <>
                  <div
                    className="notice"
                    role="note"
                    aria-label="AI detection limitations"
                  >
                    <strong>
                      Detection can miss or incorrectly select text.
                    </strong>
                    <p>
                      OpenAI Privacy Filter may miss names and other sensitive
                      text, especially in non-English documents or unfamiliar
                      layouts. Fields such as sex, citizenship and birthplace
                      may remain visible. It does not inspect images or barcode
                      contents.
                    </p>
                    <p>
                      Review the entire document before sharing. Add missed text
                      to “Always redact”, clear and re-add your files, then
                      process them again. For details inside images or barcodes,
                      use a PDF editor that permanently redacts image content if
                      they remain visible in the preview.
                    </p>
                  </div>
                  <p className="help">
                    Rules match known patterns and terms you enter. Privacy
                    Filter also uses context to identify personal information,
                    such as names and addresses, without an explicit term.
                  </p>
                  <p className="help">
                    AI mode uses OpenAI Privacy Filter. The first use downloads
                    approximately 917 MB of model weights plus runtime files.
                    Loading the model requires additional memory. Your browser
                    may cache the files, but may need to download them again.
                  </p>
                  <p className="help">
                    Processing runs locally; document contents are not sent to
                    OpenAI. AI requires a browser and GPU with WebGPU support,
                    using HTTPS or localhost. If AI processing fails, that file
                    is not exported. Rules-only mode must be selected
                    explicitly.
                  </p>
                </>
              ) : (
                <p className="notice">
                  AI is off. Rules match Italian tax codes and IBANs, bank
                  lines, the selected header area and terms you enter. Other
                  personal information may remain.
                </p>
              )}
              <div className="divider" />
              <div className="range-heading">
                <label className="field-label" htmlFor="header">
                  Employer header (PDF only)
                </label>
                <span>{Math.round(options.headerFraction * 100)}%</span>
              </div>
              <input
                id="header"
                type="range"
                min="0"
                max="100"
                value={Math.round(options.headerFraction * 100)}
                onChange={(e) =>
                  update("headerFraction", Number(e.target.value) / 100)
                }
              />
              <p className="help">
                PDF only: remove words in the top portion of each page and
                images crossing it. Recognized pay-period and net-pay fields are
                preserved. These layout rules do not apply to TXT documents.
              </p>
              <label className="field-label" htmlFor="redact">
                Always redact
              </label>
              <textarea
                id="redact"
                rows={3}
                placeholder={
                  "Person or employer name\nBank name\nOther text to remove"
                }
                value={options.redactTerms.join("\n")}
                onChange={(e) =>
                  update("redactTerms", e.target.value.split("\n"))
                }
              />
              <p className="help">
                One exact term per line. Matches ignore capitalization.
              </p>
              <label className="field-label" htmlFor="keep">
                Keep visible
              </label>
              <textarea
                id="keep"
                rows={2}
                placeholder={"Gennaio 2026\nText you want to preserve"}
                value={options.keepTerms.join("\n")}
                onChange={(e) =>
                  update("keepTerms", e.target.value.split("\n"))
                }
              />
              <p className="help">
                Overrides AI and header matches. Tax codes, IBANs, bank lines
                and “Always redact” still take priority.
              </p>
              <details>
                <summary>Advanced options</summary>
                <label className="field-label" htmlFor="regex">
                  Keep expressions
                </label>
                <textarea
                  id="regex"
                  rows={2}
                  placeholder={"EUR\\s+1[.]234,56"}
                  value={options.keepRegexes.join("\n")}
                  onChange={(e) =>
                    update("keepRegexes", e.target.value.split("\n"))
                  }
                  onBlur={(e) => update("keepRegexes", lines(e.target.value))}
                />
                <p className="help">
                  One JavaScript regular expression per line, without /
                  delimiters. Case-insensitive; Python syntax may differ.
                </p>
                <label className="field-label" htmlFor="prefix">
                  Output filename prefix
                </label>
                <input
                  id="prefix"
                  type="text"
                  value={options.prefix}
                  onChange={(e) => update("prefix", e.target.value)}
                />
                <p className="help">
                  Original filenames are replaced, for example:
                  localredact_0001.pdf or localredact_0001.txt
                </p>
              </details>
            </fieldset>
            <div className="privacy-note">
              <Icon kind="shield" size={22} />
              <div>
                <strong>File handling</strong>
                <p>
                  Documents are held in browser memory. TXT output replaces
                  matched text with [REDACTED]. PDF output removes selected text
                  and image pixels, and standard and XML metadata. Vector
                  graphics are preserved.
                </p>
              </div>
            </div>
          </aside>
        </div>
        <footer>
          <span>LocalRedact</span>
          <span>Scanned pages need OCR first · No document uploads</span>
        </footer>
      </main>
    </>
  );
}
