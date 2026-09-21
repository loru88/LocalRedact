import { textChunks } from "./rules";
import { detectSensitiveSpans } from "./detection";
import type { ProcessRequest, WorkerResponse, Span } from "./types";
import type { TokenClassificationPipeline } from "@huggingface/transformers";

let classifier: TokenClassificationPipeline | undefined;
let busy = false;
const send = (message: WorkerResponse, transfer: Transferable[] = []) =>
  self.postMessage(message, { transfer });

async function getClassifier(id: string) {
  if (classifier) return classifier;
  const gpu = (
    navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }
  ).gpu;
  if (!gpu || !(await gpu.requestAdapter())) {
    throw new Error(
      "WebGPU is unavailable. AI detection requires a compatible browser and GPU on HTTPS or localhost. Select Rules only to process without AI detection.",
    );
  }
  send({
    type: "progress",
    id,
    message:
      "Loading OpenAI Privacy Filter. Model weights require approximately 917 MB plus runtime files on first use…",
  });
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  // A single WASM thread also works on static hosts without COOP/COEP headers.
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
  classifier = await pipeline("token-classification", "openai/privacy-filter", {
    device: "webgpu",
    dtype: "q4",
    progress_callback: (event) => {
      if (event.status === "progress")
        send({
          type: "progress",
          id,
          message: `Downloading model assets · ${Math.round(event.progress)}% of ${event.file}`,
          fraction: event.progress / 100,
        });
      else if (event.status === "initiate")
        send({ type: "progress", id, message: `Loading ${event.file}…` });
    },
  });
  return classifier;
}

self.onmessage = async ({ data }: MessageEvent<ProcessRequest>) => {
  if (data.type !== "process") return;
  if (busy) {
    send({
      type: "error",
      id: data.id,
      message: "Another PDF is still processing.",
    });
    return;
  }
  busy = true;
  const { id, bytes, options } = data;
  try {
    // Register onmessage before MuPDF's asynchronous WASM initialization.
    // A top-level import can otherwise lose the first message during startup.
    const { processPdf } = await import("./pdf");
    const detect = async (text: string): Promise<Span[]> => {
      const model = await getClassifier(id);
      const chunks = textChunks(text);
      const spans: Span[] = [];
      for (let i = 0; i < chunks.length; i++) {
        send({
          type: "progress",
          id,
          message: `Finding sensitive text · section ${i + 1} of ${chunks.length}`,
        });
        const chunk = chunks[i];
        spans.push(
          ...(
            await detectSensitiveSpans(
              chunk.text,
              model,
              options.keepCategories,
            )
          ).map(([s, e]): Span => [s + chunk.offset, e + chunk.offset]),
        );
      }
      return spans;
    };
    const result = await processPdf(bytes, options, detect, (page, total) =>
      send({
        type: "progress",
        id,
        message: `Redacting page ${page} of ${total}`,
        fraction: (page - 1) / total,
      }),
    );
    send({ type: "result", id, ...result }, [result.bytes, ...result.previews]);
  } catch (error) {
    send({
      type: "error",
      id,
      message:
        error instanceof Error
          ? error.message
          : "Processing failed. No PDF was exported.",
    });
  } finally {
    busy = false;
  }
};
