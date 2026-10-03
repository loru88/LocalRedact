import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repositoryUrl = "https://github.com/loru88/LocalRedact";
const sha = process.env.LOCALREDACT_GIT_SHA;
const ref = process.env.LOCALREDACT_GIT_REF ?? "";
const revision = sha ? sha.slice(0, 7) : "local";
const revisionUrl = sha
  ? ref.startsWith("refs/tags/")
    ? `${repositoryUrl}/releases/tag/${encodeURIComponent(ref.slice("refs/tags/".length))}`
    : `${repositoryUrl}/commit/${sha}`
  : `${repositoryUrl}/releases`;

export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_REVISION__: JSON.stringify(revision),
    __APP_REVISION_URL__: JSON.stringify(revisionUrl),
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["mupdf", "@huggingface/transformers"] },
});
