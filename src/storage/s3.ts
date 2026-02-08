import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import type { StorageAdapter } from "./interface.js";

const bucket = process.env.S3_BUCKET!;
const region = process.env.S3_REGION ?? "us-east-1";

const client = new S3Client({
  region,
  endpoint: process.env.S3_ENDPOINT,
  credentials:
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
});

export const s3Storage: StorageAdapter = {
  async put(key: string, body: Buffer | Readable, contentType?: string): Promise<void> {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  },
  async get(key: string): Promise<Readable | null> {
    try {
      const out = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key })
      );
      return (out.Body as Readable) ?? null;
    } catch {
      return null;
    }
  },
  async delete(key: string): Promise<void> {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
};
