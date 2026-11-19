declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export const OPS: Record<string, number>;
  export function getDocument(options: Record<string, unknown>): {
    promise: Promise<any>;
  };
}
