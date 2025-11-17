import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.S3_REGION!,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET!;

/**
 * Upload a file to S3
 * @param key - S3 object key (path/filename)
 * @param body - File content (Buffer, Readable, or string)
 * @param contentType - MIME type
 * @returns S3 URL
 */
export async function uploadFile(
  key: string,
  body: Buffer | Readable | string,
  contentType?: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await s3Client.send(command);

  // Return the S3 URL
  return `s3://${BUCKET_NAME}/${key}`;
}

/**
 * Generate a signed URL for downloading a file (expires in 1 hour)
 * @param key - S3 object key
 * @param expiresIn - Expiration in seconds (default: 3600 = 1 hour)
 * @returns Signed URL
 */
export async function getSignedDownloadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Delete a file from S3
 * @param key - S3 object key
 */
export async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}

/**
 * Check if a file exists in S3
 * @param key - S3 object key
 * @returns true if exists, false otherwise
 */
export async function fileExists(key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch (error: any) {
    if (error.name === "NotFound") {
      return false;
    }
    throw error;
  }
}

/**
 * Download a file from S3 as a Buffer
 * @param key - S3 object key
 * @returns File content as Buffer
 */
export async function downloadFile(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const response = await s3Client.send(command);

  // Convert stream to buffer
  const stream = response.Body as Readable;
  const chunks: Uint8Array[] = [];
  
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Upload multiple files to S3 (batch operation)
 * @param files - Array of { key, body, contentType }
 * @returns Array of S3 URLs
 */
export async function uploadFiles(
  files: Array<{ key: string; body: Buffer | Readable | string; contentType?: string }>
): Promise<string[]> {
  const uploadPromises = files.map((file) =>
    uploadFile(file.key, file.body, file.contentType)
  );

  return await Promise.all(uploadPromises);
}

/**
 * Recursively upload a directory to S3
 * @param localDir - Local directory path to upload
 * @param s3Prefix - S3 key prefix (e.g., "results/job-123/attempt-0/")
 * @returns Array of uploaded S3 URLs
 */
export async function uploadDirectory(
  localDir: string,
  s3Prefix: string
): Promise<string[]> {
  const { readdir, stat, readFile } = await import("fs/promises");
  const { join } = await import("path");
  
  const uploadedUrls: string[] = [];
  
  async function uploadRecursive(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir);
    
    for (const entry of entries) {
      const localPath = join(dir, entry);
      const stats = await stat(localPath);
      
      if (stats.isDirectory()) {
        // Recursively upload subdirectories
        await uploadRecursive(localPath, `${prefix}${entry}/`);
      } else {
        // Upload file
        const fileContent = await readFile(localPath);
        const s3Key = `${prefix}${entry}`;
        
        // Determine content type based on file extension
        let contentType: string | undefined;
        if (entry.endsWith(".json")) {
          contentType = "application/json";
        } else if (entry.endsWith(".txt") || entry.endsWith(".log")) {
          contentType = "text/plain";
        } else if (entry.endsWith(".md")) {
          contentType = "text/markdown";
        }
        
        const s3Url = await uploadFile(s3Key, fileContent, contentType);
        uploadedUrls.push(s3Url);
      }
    }
  }
  
  await uploadRecursive(localDir, s3Prefix);
  return uploadedUrls;
}

