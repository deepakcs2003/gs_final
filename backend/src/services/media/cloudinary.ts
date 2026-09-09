import { v2 as cloudinary } from 'cloudinary';
import { env, integrations } from '../../config/env.js';
import { badRequest } from '../../utils/errors.js';

/**
 * Cloudinary handles delivery (README §56: WebP/AVIF, responsive sizes, CDN).
 *
 * Uploads always go through the server, never straight from the browser with an
 * unsigned preset — an unsigned preset is an open file-drop for the internet.
 */

if (integrations.cloudinary) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

/** Magic-byte signatures — the only trustworthy statement of a file's type. */
const SIGNATURES: Array<{ mime: string; ext: string; test: (buf: Buffer) => boolean }> = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) => b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Validates real content, not the client-supplied filename or Content-Type.
 * A `.jpg` that is actually an HTML file would otherwise become stored XSS.
 */
export function assertSafeImage(buffer: Buffer): { mime: string; ext: string } {
  if (buffer.length === 0) throw badRequest('Image file khaali hai.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw badRequest('Image 5MB se choti honi chahiye.');

  const match = SIGNATURES.find((sig) => sig.test(buffer));
  if (!match) throw badRequest('Sirf JPG, PNG ya WebP image upload karein.');

  return { mime: match.mime, ext: match.ext };
}

export interface UploadedImage {
  url: string;
  publicId: string;
  width: number;
  height: number;
}

export async function uploadImage(buffer: Buffer, folder: string): Promise<UploadedImage> {
  assertSafeImage(buffer);
  if (!integrations.cloudinary) {
    throw badRequest('Image upload abhi configure nahi hai.');
  }

  // Folder is server-chosen, never taken from the request — that closes the
  // path-traversal route into other tenants' folders.
  const safeFolder = `${env.CLOUDINARY_UPLOAD_FOLDER}/${folder.replace(/[^a-z0-9_-]/gi, '')}`;

  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: safeFolder,
        resource_type: 'image',
        // Server-generated public id; the original filename is discarded.
        use_filename: false,
        unique_filename: true,
        overwrite: false,
        // Strip metadata (including GPS coordinates from phone photos).
        image_metadata: false,
        transformation: [{ quality: 'auto:good', fetch_format: 'auto' }],
      },
      (error, uploaded) => {
        if (error || !uploaded) reject(error ?? new Error('upload failed'));
        else resolve(uploaded as unknown as Record<string, unknown>);
      },
    );
    stream.end(buffer);
  });

  return {
    url: String(result.secure_url ?? ''),
    publicId: String(result.public_id ?? ''),
    width: Number(result.width ?? 0),
    height: Number(result.height ?? 0),
  };
}

export async function deleteImage(publicId: string): Promise<void> {
  if (!integrations.cloudinary || !publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
}

/**
 * Builds a responsive Cloudinary URL. Non-Cloudinary URLs (e.g. seeded demo
 * images) pass through untouched.
 */
export function responsiveUrl(url: string, width: number): string {
  if (!url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/f_auto,q_auto,w_${Math.round(width)},c_limit/`);
}

export const cloudinaryEnabled = () => integrations.cloudinary;
