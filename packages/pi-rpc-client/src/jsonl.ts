import { createLogger, type Logger } from "./logger";

/**
 * JSONL Framer — LF-only line splitting for pi RPC protocol.
 *
 * IMPORTANT: Must NOT use Node `readline` which also splits on
 * U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR).
 * Those are valid inside JSON strings and would corrupt payloads.
 *
 * Also strips trailing \r from \r\n input for Windows compatibility.
 */
export class JsonlFramer {
  private buffer = "";
  private log: Logger;

  constructor() {
    this.log = createLogger("pi-rpc:jsonl");
  }

  /**
   * Push a chunk of data (string or Buffer).
   * Returns an array of complete, parseable JSON strings.
   */
  push(chunk: string | Buffer): string[] {
    const str = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    this.buffer += str;

    const lines: string[] = [];
    let idx: number;

    // Split on LF only — do NOT use generic line splitting
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);

      // Strip trailing \r (Windows \r\n → \n)
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      // Skip empty lines (keep-alive or spacing)
      if (line.length === 0) continue;

      lines.push(line);
    }

    if (lines.length > 0) {
      this.log.debug({ total: lines.length }, `parsed ${lines.length} JSONL lines`);
    }

    return lines;
  }

  /**
   * Flush any remaining partial line in the buffer.
   * Called when the stream ends.
   */
  flush(): string[] {
    if (this.buffer.length === 0) return [];

    let line = this.buffer;
    const partialLen = line.length;
    this.buffer = "";

    if (line.endsWith("\r")) {
      line = line.slice(0, -1);
    }

    if (line.length === 0) return [];

    this.log.debug({ length: partialLen }, "flushed partial line");

    return [line];
  }

  /** Reset internal state. */
  reset(): void {
    if (this.buffer.length > 0) {
      this.log.debug({ len: this.buffer.length }, "resetting framer with buffered data");
    }
    this.buffer = "";
  }
}
