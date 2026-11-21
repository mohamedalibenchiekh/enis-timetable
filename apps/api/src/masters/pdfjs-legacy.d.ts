declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export const OPS: Record<string, number>;
  export interface PDFTextContent {
    items: unknown[];
  }
  export interface PDFPageProxy {
    getTextContent(options: Record<string, unknown>): Promise<PDFTextContent>;
    getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  }
  export interface PDFDocumentProxy {
    numPages: number;
    getPage(page: number): Promise<PDFPageProxy>;
    destroy(): Promise<void>;
  }
  export interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>;
    destroy(): Promise<void>;
  }
  export function getDocument(options: Record<string, unknown>): PDFDocumentLoadingTask;
}
