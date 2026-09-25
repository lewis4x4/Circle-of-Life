import sharp from "sharp";

import { DocumentIntakeByteError } from "./bytes";

/**
 * A PNG preview of an image the browser cannot show (HEIC/HEIF/TIFF/WEBP).
 * Preview only: the stored original is never changed.
 */
export async function convertToPreviewPng(bytes: Uint8Array) {
  try {
    return new Uint8Array(await sharp(bytes, { limitInputPixels: 100_000_000, failOn: "error" })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer());
  } catch {
    throw new DocumentIntakeByteError("unsupported", "A preview of this image could not be made; download the original instead");
  }
}
