import type { StorageAdapter } from "./interface.js";
import { filesystemStorage } from "./filesystem.js";
import { s3Storage } from "./s3.js";

export const storage: StorageAdapter =
  process.env.FILE_STORAGE === "s3" ? s3Storage : filesystemStorage;
