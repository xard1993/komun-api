import type { Readable } from "node:stream";

export interface StorageAdapter {
  put(key: string, body: Buffer | Readable, contentType?: string): Promise<void>;
  get(key: string): Promise<Readable | null>;
  delete(key: string): Promise<void>;
}
