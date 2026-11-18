/** pdf.js ships no types for its worker module; it is only loaded for its side effects. */
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
