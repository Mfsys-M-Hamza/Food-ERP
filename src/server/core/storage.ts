import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { env } from "./env";
import { AppError, validationFailed } from "./errors";
import type { Ctx } from "./context";

/**
 * File storage abstraction.
 * - local: development only; writes to public/uploads (not usable on Vercel).
 * - supabase: Supabase Storage via its REST API using the server-only service key.
 * SVG is not accepted (can carry scripts).
 */
const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export type UploadResult = { url: string; path: string; bucket: string };

export async function uploadPublicImage(
  ctx: Ctx,
  file: File,
  opts: { folder: string; maxBytes?: number },
): Promise<UploadResult> {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const ext = IMAGE_TYPES[file.type];
  if (!ext) throw validationFailed({ file: ["Use a PNG, JPG or WebP image"] });
  if (file.size > maxBytes) throw validationFailed({ file: [`Image must be under ${Math.round(maxBytes / 1024 / 1024)} MB`] });
  if (!/^[a-z0-9-]+$/.test(opts.folder)) throw new AppError("INTERNAL", "Invalid storage folder");

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!matchesMagicBytes(bytes, file.type)) throw validationFailed({ file: ["The file content does not match its type"] });

  const objectPath = `${opts.folder}/${new Date().getFullYear()}/${randomUUID()}.${ext}`;
  const e = env();
  let result: UploadResult;

  if (e.STORAGE_DRIVER === "supabase") {
    if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) throw new AppError("INTERNAL", "Storage is not configured");
    const bucket = e.SUPABASE_PUBLIC_BUCKET;
    const res = await fetch(`${e.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
      method: "POST",
      headers: {
        ...supabaseAuth(e.SUPABASE_SERVICE_ROLE_KEY),
        "Content-Type": file.type,
        "x-upsert": "false",
        "cache-control": "public, max-age=31536000, immutable",
      },
      body: bytes,
    });
    if (!res.ok) throw new AppError("INTERNAL", "Upload failed. Please try again.");
    result = { bucket, path: objectPath, url: `${e.SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}` };
  } else {
    if (e.NODE_ENV === "production" && process.env.VERCEL) {
      throw new AppError("INTERNAL", "Local storage cannot be used on Vercel. Set STORAGE_DRIVER=supabase.");
    }
    const target = path.join(process.cwd(), "public", "uploads", objectPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    result = { bucket: "local", path: objectPath, url: `/uploads/${objectPath}` };
  }

  await db.fileObject.create({
    data: { bucket: result.bucket, path: result.path, mimeType: file.type, sizeBytes: file.size, isPublic: true, uploadedBy: ctx.user.id },
  });
  return result;
}

/** Headers for Supabase Storage: works with legacy service_role JWTs and the newer sb_secret_ keys (which go in `apikey`). */
function supabaseAuth(key: string): Record<string, string> {
  return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

function matchesMagicBytes(b: Buffer, type: string): boolean {
  if (type === "image/png") return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === "image/webp") return b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

// ─── Private documents (expense receipts) ────────────────────────────────────
// Never publicly addressable: served only through an authorised route handler.

const DOC_TYPES: Record<string, string> = { ...IMAGE_TYPES, "application/pdf": "pdf" };

function privateLocalPath(objectPath: string) {
  return path.join(process.cwd(), ".data", "private-uploads", objectPath);
}

export async function uploadPrivateDocument(
  ctx: Ctx,
  file: File,
  opts: { folder: string; maxBytes?: number },
): Promise<{ id: string }> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const ext = DOC_TYPES[file.type];
  if (!ext) throw validationFailed({ file: ["Use a photo (PNG, JPG, WebP) or a PDF"] });
  if (file.size > maxBytes) throw validationFailed({ file: [`File must be under ${Math.round(maxBytes / 1024 / 1024)} MB`] });
  if (!/^[a-z0-9-]+$/.test(opts.folder)) throw new AppError("INTERNAL", "Invalid storage folder");
  const bytes = Buffer.from(await file.arrayBuffer());
  const ok = file.type === "application/pdf" ? bytes.subarray(0, 5).toString("ascii") === "%PDF-" : matchesMagicBytes(bytes, file.type);
  if (!ok) throw validationFailed({ file: ["The file content does not match its type"] });

  const objectPath = `${opts.folder}/${new Date().getFullYear()}/${randomUUID()}.${ext}`;
  const e = env();
  let bucket: string;
  if (e.STORAGE_DRIVER === "supabase") {
    if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) throw new AppError("INTERNAL", "Storage is not configured");
    bucket = e.SUPABASE_PRIVATE_BUCKET;
    const res = await fetch(`${e.SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`, {
      method: "POST",
      headers: { ...supabaseAuth(e.SUPABASE_SERVICE_ROLE_KEY), "Content-Type": file.type, "x-upsert": "false" },
      body: bytes,
    });
    if (!res.ok) throw new AppError("INTERNAL", "Upload failed. Please try again.");
  } else {
    if (e.NODE_ENV === "production" && process.env.VERCEL) {
      throw new AppError("INTERNAL", "Local storage cannot be used on Vercel. Set STORAGE_DRIVER=supabase.");
    }
    bucket = "local-private";
    const target = privateLocalPath(objectPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  const row = await db.fileObject.create({
    data: { bucket, path: objectPath, mimeType: file.type, sizeBytes: file.size, isPublic: false, uploadedBy: ctx.user.id },
  });
  return { id: row.id };
}

/** Load a private document's bytes. Callers must authorise access first. */
export async function readPrivateDocument(fileId: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const f = await db.fileObject.findUnique({ where: { id: fileId } });
  if (!f || f.isPublic) return null;
  const e = env();
  if (f.bucket === "local-private") {
    try {
      return { bytes: await readFile(privateLocalPath(f.path)), mimeType: f.mimeType };
    } catch {
      return null;
    }
  }
  if (!e.SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) return null;
  const res = await fetch(`${e.SUPABASE_URL}/storage/v1/object/authenticated/${f.bucket}/${f.path}`, {
    headers: { ...supabaseAuth(e.SUPABASE_SERVICE_ROLE_KEY) },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: f.mimeType };
}
