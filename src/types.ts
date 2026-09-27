export const CATEGORIES = [
  "account_number",
  "private_address",
  "private_email",
  "private_person",
  "private_phone",
  "private_url",
  "private_date",
  "secret",
] as const;
export type Category = (typeof CATEGORIES)[number];
export type Rect = [number, number, number, number];
export type Span = [number, number];
export type DocumentFormat = "pdf" | "txt";
export type Detect = (text: string) => Promise<Span[]>;
export interface Word {
  start: number;
  end: number;
  rect: Rect;
  line: number;
}
export interface PageText {
  text: string;
  words: Word[];
  images: Rect[];
}
export interface Options {
  useAi: boolean;
  enabledRules: string[];
  redactHeader: boolean;
  headerFraction: number;
  redactTerms: string[];
  keepTerms: string[];
  keepRegexes: string[];
  prefix: string;
}
export const DEFAULT_OPTIONS: Options = {
  useAi: false,
  enabledRules: [],
  redactHeader: false,
  headerFraction: 0.18,
  redactTerms: [],
  keepTerms: [],
  keepRegexes: [],
  prefix: "localredact",
};
export interface ProcessRequest {
  type: "process";
  id: string;
  bytes: ArrayBuffer;
  format: DocumentFormat;
  options: Options;
}
export type DocumentOutput =
  | {
      format: "pdf";
      bytes: ArrayBuffer;
      previews: ArrayBuffer[];
      marks: number;
      pages: number;
    }
  | { format: "txt"; bytes: ArrayBuffer; text: string; marks: number };
export type WorkerResponse =
  | { type: "progress"; id: string; message: string; fraction?: number }
  | ({ type: "result"; id: string } & DocumentOutput)
  | { type: "error"; id: string; message: string };
