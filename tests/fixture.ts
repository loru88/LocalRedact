import * as mupdf from "mupdf";

export function fixture({
  blankPage = false,
  secondPage,
  rotate = 0,
  headerImage = false,
  formDate = false,
  payrollDates = false,
}: {
  blankPage?: boolean;
  secondPage?: "image" | "vector" | "emptyForm" | "text";
  rotate?: 0 | 90;
  headerImage?: boolean;
  formDate?: boolean;
  payrollDates?: boolean;
} = {}) {
  const doc = new mupdf.PDFDocument();
  const font = new mupdf.Font("Helvetica");
  const fontRef = doc.addSimpleFont(font);
  const lines: [number, number, string][] = [
    [45, 50, "ACME DEMO SRL"],
    [45, 75, "Via Esempio 12, Roma"],
    [350, 50, "PERIODO"],
    [350, 68, "Gennaio 2026"],
    [45, 240, "Dipendente: Mario Rossi"],
    [45, 265, "Codice fiscale: RSSMRA80A01H501U"],
    [45, 290, "Email: info@example.com"],
    [45, 320, "BANCA ESEMPIO - Conto 123456789"],
    [45, 350, "IBAN IT60X0542811101000000123456"],
    [45, 380, "IBAN GB82 WEST 1234 5698 7654 32"],
    [45, 430, "Retribuzione ordinaria 2.500,00"],
    [400, 690, "NETTO DEL MESE"],
    [400, 708, "1.950,00"],
  ];
  if (formDate)
    lines.push(
      [45, 480, "GIORNO MESE ANNO"],
      [45, 500, "29"],
      [45, 520, "02"],
      [45, 540, "2000"],
      [45, 570, "Unrelated value: 12345"],
    );
  if (payrollDates)
    lines.push([45, 600, "AL 01/01/2026"], [45, 620, "dal 1/1/2025 alla data"]);
  const contents = lines
    .map(([x, y, text]) => `BT /F1 11 Tf ${x} ${842 - y} Td (${text}) Tj ET`)
    .join("\n");
  const pixmap = new mupdf.Pixmap(
    mupdf.ColorSpace.DeviceRGB,
    [0, 0, 4, 4],
    false,
  );
  pixmap.clear(180);
  const image = new mupdf.Image(pixmap);
  const imageRef = doc.addImage(image);
  const pageRef = doc.addPage(
    [0, 0, 595, 842],
    rotate,
    { Font: { F1: fontRef }, XObject: { Logo: imageRef } },
    contents + (headerImage ? "\nq 40 0 0 30 45 712 cm /Logo Do Q" : ""),
  );
  doc.insertPage(-1, pageRef);
  const page = doc.loadPage(0);
  const annotation = page.createAnnotation("Text");
  annotation.setRect([10, 400, 30, 420]);
  annotation.setContents("Sensitive annotation from original");
  annotation.update();
  page.destroy();
  if (secondPage === "text") {
    const second = doc.addPage(
      [0, 0, 595, 842],
      rotate,
      { Font: { F1: fontRef } },
      contents,
    );
    doc.insertPage(-1, second);
    second.destroy();
  }
  if (blankPage || (secondPage && secondPage !== "text")) {
    const emptyForm = doc.addStream("", {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 595, 842],
      Resources: {},
    });
    const contents =
      secondPage === "image"
        ? "q 200 0 0 200 40 40 cm /Logo Do Q"
        : secondPage === "vector"
          ? "1 1 1 rg 40 40 200 200 re f"
          : secondPage === "emptyForm"
            ? "q /Empty Do Q"
            : "";
    const blank = doc.addPage(
      [0, 0, 595, 842],
      rotate,
      { XObject: { Logo: imageRef, Empty: emptyForm } },
      contents,
    );
    emptyForm.destroy();
    doc.insertPage(-1, blank);
    blank.destroy();
  }
  doc.setMetaData("info:Author", "Sensitive author");
  doc.setMetaData("info:Title", "Sensitive title");
  const metadata = doc.addStream(
    "<x:xmpmeta>Sensitive XML metadata</x:xmpmeta>",
    { Type: "Metadata", Subtype: "XML" },
  );
  const trailer = doc.getTrailer();
  const root = trailer.get("Root");
  root.put("Metadata", metadata);
  const attachment = doc.addEmbeddedFile(
    "private.txt",
    "text/plain",
    "Sensitive attachment",
    new Date(0),
    new Date(0),
    false,
  );
  doc.insertEmbeddedFile("private.txt", attachment);
  const saved = doc.saveToBuffer("");
  const bytes = new Uint8Array(saved.asUint8Array()).buffer;
  saved.destroy();
  attachment.destroy();
  root.destroy();
  trailer.destroy();
  metadata.destroy();
  pageRef.destroy();
  fontRef.destroy();
  font.destroy();
  imageRef.destroy();
  image.destroy();
  pixmap.destroy();
  doc.destroy();
  return bytes;
}
