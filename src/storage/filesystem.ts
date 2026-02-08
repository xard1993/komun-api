import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import type { StorageAdapter } from "./interface.js";

const UPLOAD_PATH = process.env.UPLOAD_PATH ?? "./uploads";

function fullPath(key: string): string {
  const safe = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(UPLOAD_PATH, safe);
}

export const filesystemStorage: StorageAdapter = {
  async put(key: string, body: Buffer | Readable, _contentType?: string): Promise<void> {
    const filePath = fullPath(key);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    if (Buffer.isBuffer(body)) {
      await fs.promises.writeFile(filePath, body);
    } else {
      const writeStream = fs.createWriteStream(filePath);
      await new Promise<void>((resolve, reject) => {
        body.pipe(writeStream);
        body.on("error", reject);
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });
    }
  },
  async get(key: string): Promise<Readable | null> {
    const filePath = fullPath(key);
    try {
      await fs.promises.access(filePath);
    } catch {
      return null;
    }
    return fs.createReadStream(filePath);
  },
  async delete(key: string): Promise<void> {
    const filePath = fullPath(key);
    await fs.promises.unlink(filePath).catch(() => {});
  },
};
