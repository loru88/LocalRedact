import * as mupdf from "mupdf";
import { redactionRects, union, validateOptions } from "./rules";
import type { Detect, Options, PageText, Rect } from "./types";

export function extractPage(page: mupdf.PDFPage): PageText {
  const structured = page.toStructuredText("preserve-images");
  const lines: { rect: Rect; words: { text: string; rect: Rect }[] }[] = [];
  const images: Rect[] = [];
  let current: (typeof lines)[number] | undefined;
  let word: { text: string; rect: Rect } | undefined;
  const flush = () => {
    if (word && current) current.words.push(word);
    word = undefined;
  };
  try {
    structured.walk({
      beginLine: (rect) => {
        current = { rect: [...rect], words: [] };
        lines.push(current);
      },
      onChar: (c, _origin, _font, _size, quad) => {
        if (/\s/u.test(c)) {
          flush();
          return;
        }
        const rect: Rect = [
          Math.min(quad[0], quad[2], quad[4], quad[6]),
          Math.min(quad[1], quad[3], quad[5], quad[7]),
          Math.max(quad[0], quad[2], quad[4], quad[6]),
          Math.max(quad[1], quad[3], quad[5], quad[7]),
        ];
        if (word) {
          word.text += c;
          word.rect = union(word.rect, rect);
        } else word = { text: c, rect };
      },
      endLine: flush,
      onImageBlock: (rect) => images.push([...rect]),
    });
  } finally {
    structured.destroy();
  }
  lines.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  const result: PageText = { text: "", words: [], images };
  lines.forEach((line, index) => {
    for (const w of line.words) {
      if (result.text)
        result.text += result.words.at(-1)?.line === index ? " " : "\n";
      const start = result.text.length;
      result.text += w.text;
      result.words.push({
        start,
        end: result.text.length,
        rect: w.rect,
        line: index,
      });
    }
  });
  return result;
}

export async function processPdf(
  bytes: ArrayBuffer,
  options: Options,
  detect: Detect,
  progress: (page: number, total: number) => void,
) {
  validateOptions(options);
  const source = new mupdf.PDFDocument(bytes);
  const output = new mupdf.PDFDocument();
  let marks = 0;
  try {
    if (source.needsPassword())
      throw new Error(
        "This PDF is password-protected. Open and decrypt it locally before adding it.",
      );
    const pages = source.countPages();
    if (!pages) throw new Error("This PDF has no pages.");
    // Preflight the whole document before downloading a model or redacting pages.
    for (let i = 0; i < pages; i++) {
      const page = source.loadPage(i);
      try {
        if (page.getWidgets().length)
          throw new Error(
            `Page ${i + 1} contains form fields. Flatten the form locally first.`,
          );
        if (!extractPage(page).text.trim())
          throw new Error(
            `Page ${i + 1} has no searchable text. Run OCR locally first; no PDF was exported.`,
          );
      } finally {
        page.destroy();
      }
    }
    for (let i = 0; i < pages; i++) {
      progress(i + 1, pages);
      const page = source.loadPage(i);
      try {
        const extracted = extractPage(page);
        const spans =
          options.mode === "model" ? await detect(extracted.text) : [];
        const rects = redactionRects(
          extracted,
          page.getBounds(),
          options,
          spans,
        );
        for (const rect of rects) {
          const annot = page.createAnnotation("Redact");
          annot.setRect(rect);
          annot.update();
        }
        if (rects.length)
          page.applyRedactions(
            true,
            mupdf.PDFPage.REDACT_IMAGE_PIXELS,
            mupdf.PDFPage.REDACT_LINE_ART_NONE,
            mupdf.PDFPage.REDACT_TEXT_REMOVE,
          );
        marks += rects.length;
        // Graft only page content/resources into a fresh PDF, excluding original
        // document metadata, attachments, outlines, forms and annotations.
        output.graftPage(-1, source, i);
      } finally {
        page.destroy();
      }
    }
    // Also remove XML metadata attached to pages, images or other resources.
    for (let i = 1; i < output.countObjects(); i++) {
      const ref = output.newIndirect(i);
      const obj = ref.resolve();
      try {
        if (obj.isDictionary() || obj.isStream()) {
          obj.delete("Metadata");
          obj.delete("PieceInfo");
        }
      } finally {
        obj.destroy();
        ref.destroy();
      }
    }
    const trailer = output.getTrailer();
    try {
      trailer.delete("Info");
      trailer.delete("ID");
    } finally {
      trailer.destroy();
    }
    const saved = output.saveToBuffer("garbage=4,compress=yes,clean=yes");
    let data: ArrayBuffer;
    try {
      data = new Uint8Array(saved.asUint8Array()).buffer;
    } finally {
      saved.destroy();
    }
    // Render the saved artifact, so the preview represents the actual download.
    const check = new mupdf.PDFDocument(data);
    const previews: ArrayBuffer[] = [];
    try {
      for (let i = 0; i < pages; i++) {
        const page = check.loadPage(i);
        try {
          const bounds = page.getBounds();
          const scale = Math.min(
            1.5,
            1200 / Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]),
          );
          const pixmap = page.toPixmap(
            mupdf.Matrix.scale(scale, scale),
            mupdf.ColorSpace.DeviceRGB,
            false,
            false,
          );
          try {
            previews.push(new Uint8Array(pixmap.asPNG()).buffer);
          } finally {
            pixmap.destroy();
          }
        } finally {
          page.destroy();
        }
      }
    } finally {
      check.destroy();
    }
    return { bytes: data, previews, marks, pages };
  } finally {
    output.destroy();
    source.destroy();
  }
}
