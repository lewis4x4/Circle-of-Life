/**
 * MD5 (RFC 1321) in plain TypeScript with no dependency, for COL-143 evidence.
 *
 * The browser computes the MD5 of the bytes it is about to upload and declares
 * it at preparation; the database verifies that declaration against the
 * Storage service's eTag (the MD5 of the stored bytes for a single-request
 * upload) when the upload is marked and again at finalization. MD5 is used
 * here only because it is the fingerprint Storage exposes; it is a content
 * identity for comparison with a server-written value, not a security hash.
 * The class is incremental so a large file can be hashed chunk by chunk
 * without holding it in memory at once.
 */

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
  15, 21, 6, 10, 15, 21,
];

// floor(abs(sin(i + 1)) * 2^32) for i in 0..63, as tabulated in RFC 1321.
const CONSTANTS = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

const BLOCK_BYTES = 64;

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

/** Incremental MD5 over Uint8Array chunks. Call `update` any number of times, then `digest` or `hex` once. */
export class Md5 {
  private a = 0x67452301;
  private b = 0xefcdab89;
  private c = 0x98badcfe;
  private d = 0x10325476;
  private readonly block = new Uint8Array(BLOCK_BYTES);
  private readonly words = new Uint32Array(16);
  private blockLength = 0;
  private totalBytes = 0;
  private finished = false;

  update(chunk: Uint8Array): this {
    if (this.finished) throw new Error("Md5 digest already produced");
    let offset = 0;
    this.totalBytes += chunk.length;
    while (offset < chunk.length) {
      const take = Math.min(BLOCK_BYTES - this.blockLength, chunk.length - offset);
      this.block.set(chunk.subarray(offset, offset + take), this.blockLength);
      this.blockLength += take;
      offset += take;
      if (this.blockLength === BLOCK_BYTES) {
        this.compress();
        this.blockLength = 0;
      }
    }
    return this;
  }

  /** The 16-byte digest; the instance cannot be updated afterwards. */
  digest(): Uint8Array {
    if (this.finished) throw new Error("Md5 digest already produced");
    this.finished = true;
    const bitLength = this.totalBytes * 8;
    // Padding: one 0x80 byte, zeros to 56 mod 64, then the 64-bit little-endian bit length.
    this.block[this.blockLength++] = 0x80;
    if (this.blockLength > BLOCK_BYTES - 8) {
      this.block.fill(0, this.blockLength);
      this.compress();
      this.blockLength = 0;
    }
    this.block.fill(0, this.blockLength);
    const view = new DataView(this.block.buffer);
    view.setUint32(BLOCK_BYTES - 8, bitLength >>> 0, true);
    view.setUint32(BLOCK_BYTES - 4, Math.floor(bitLength / 0x100000000) >>> 0, true);
    this.compress();
    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    outView.setUint32(0, this.a >>> 0, true);
    outView.setUint32(4, this.b >>> 0, true);
    outView.setUint32(8, this.c >>> 0, true);
    outView.setUint32(12, this.d >>> 0, true);
    return out;
  }

  /** The digest as 32 lowercase hex characters, the form `operation_evidence.declared_md5` accepts. */
  hex(): string {
    return toHex(this.digest());
  }

  private compress(): void {
    const view = new DataView(this.block.buffer);
    for (let i = 0; i < 16; i += 1) this.words[i] = view.getUint32(i * 4, true);
    let a = this.a;
    let b = this.b;
    let c = this.c;
    let d = this.d;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + CONSTANTS[i] + this.words[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, SHIFTS[i])) >>> 0;
    }
    this.a = (this.a + a) >>> 0;
    this.b = (this.b + b) >>> 0;
    this.c = (this.c + c) >>> 0;
    this.d = (this.d + d) >>> 0;
  }
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** MD5 of a byte array as 32 lowercase hex characters. */
export function md5Hex(bytes: Uint8Array): string {
  return new Md5().update(bytes).hex();
}

/** Default chunk read from a Blob while hashing in the browser (4 MiB). */
export const MD5_BLOB_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * MD5 of a Blob or File read chunk by chunk, so a 20 MiB evidence file is
 * never held in memory twice. The result is what the prepare payload declares
 * as `md5`.
 */
export async function md5OfBlob(blob: Blob, chunkSize: number = MD5_BLOB_CHUNK_BYTES): Promise<string> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("chunkSize must be a positive whole number of bytes");
  const hash = new Md5();
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const buffer = await blob.slice(offset, Math.min(offset + chunkSize, blob.size)).arrayBuffer();
    hash.update(new Uint8Array(buffer));
  }
  return hash.hex();
}
