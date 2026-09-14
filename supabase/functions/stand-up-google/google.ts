import { MAX_WORKBOOK_BYTES } from "./xlsx.ts";

export type Fetcher = typeof fetch;
export class ProviderHttpError extends Error {
  constructor(
    readonly provider: "google_auth" | "google_drive",
    readonly status: number,
  ) {
    super(
      `Provider returned HTTP ${status}; no successful synchronization recorded`,
    );
  }
}
export class GoogleReconnectRequired extends Error {}
export class GoogleSnapshotUnstable extends Error {}

export type GoogleCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};
export type GoogleTokenResult = {
  accessToken: string;
  replacementRefreshToken?: string;
};
export type DriveMetadata = {
  id: string;
  mimeType: string;
  etag: string;
  version: string;
  headRevisionId: string;
  md5Checksum: string;
  fileSize: string;
  labels: { trashed: false };
};
export type StableSnapshot = {
  bytes: Uint8Array;
  metadata: DriveMetadata;
};

const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export function strongEtag(value: unknown): value is string {
  return typeof value === "string" && /^"[\x21\x23-\x7e]+"$/.test(value);
}

function rotateLeft(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}
export function md5Hex(input: Uint8Array): string {
  const length = input.length;
  const paddedLength = Math.ceil((length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = BigInt(length) * 8n;
  view.setUint32(paddedLength - 8, Number(bitLength & 0xffffffffn), true);
  view.setUint32(paddedLength - 4, Number(bitLength >> 32n), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const shifts = [
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
  ];
  const constants = Array.from(
    { length: 64 },
    (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) >>> 0,
  );
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = Array.from(
      { length: 16 },
      (_, index) => view.getUint32(offset + index * 4, true),
    );
    let a = a0, b = b0, c = c0, d = d0;
    for (let index = 0; index < 64; index++) {
      let f: number, g: number;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }
      const next = d;
      d = c;
      c = b;
      b = (b +
        rotateLeft(
          (a + f + constants[index] + words[g]) >>> 0,
          shifts[index],
        )) >>> 0;
      a = next;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const output = new Uint8Array(16), outputView = new DataView(output.buffer);
  [a0, b0, c0, d0].forEach((value, index) =>
    outputView.setUint32(index * 4, value, true)
  );
  return Array.from(output).map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function safeBody(
  response: Response,
  maximum: number,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw new Error("Provider response exceeds limit");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maximum) {
      await reader.cancel();
      throw new Error("Provider response exceeds limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function checkedFetch(
  fetcher: Fetcher,
  provider: ProviderHttpError["provider"],
  input: string,
  init: RequestInit,
  maximum: number,
): Promise<{ response: Response; bytes: Uint8Array }> {
  const response = await fetcher(input, { ...init, redirect: "error" });
  const bytes = await safeBody(response, maximum);
  if (!response.ok) throw new ProviderHttpError(provider, response.status);
  return { response, bytes };
}

export async function credentialFingerprint(
  credentials: GoogleCredentials,
): Promise<string> {
  const joined = new TextEncoder().encode(
    `${credentials.refreshToken}\0${credentials.clientId}\0${credentials.clientSecret}`,
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", joined)),
  ).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function refreshGoogleAccessToken(
  credentials: GoogleCredentials,
  fetcher: Fetcher = fetch,
): Promise<GoogleTokenResult> {
  const body = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: "refresh_token",
  });
  let response: { bytes: Uint8Array };
  try {
    response = await checkedFetch(
      fetcher,
      "google_auth",
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
      1024 * 1024,
    );
  } catch (error) {
    if (
      error instanceof ProviderHttpError && [400, 401].includes(error.status)
    ) {
      throw new GoogleReconnectRequired(
        "Google connector credentials expired or were revoked",
      );
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(response.bytes));
  } catch {
    throw new Error("Google authentication returned an invalid response");
  }
  const token = (parsed as Record<string, unknown>)?.access_token;
  if (typeof token !== "string" || !token) {
    throw new Error("Google authentication returned an invalid response");
  }
  const replacement = (parsed as Record<string, unknown>).refresh_token;
  if (
    replacement !== undefined &&
    (typeof replacement !== "string" || !replacement)
  ) throw new Error("Google authentication returned an invalid response");
  return {
    accessToken: token,
    ...(typeof replacement === "string"
      ? { replacementRefreshToken: replacement }
      : {}),
  };
}

function validateMetadata(value: unknown, fileId: string): DriveMetadata {
  const metadata = value as Record<string, unknown>;
  const labels = metadata?.labels as Record<string, unknown> | undefined;
  if (
    metadata?.id !== fileId || metadata?.mimeType !== XLSX ||
    labels?.trashed !== false || !strongEtag(metadata?.etag) ||
    typeof metadata?.version !== "string" || !/^\d+$/.test(metadata.version) ||
    typeof metadata?.headRevisionId !== "string" || !metadata.headRevisionId ||
    typeof metadata?.md5Checksum !== "string" ||
    !/^[a-f0-9]{32}$/i.test(metadata.md5Checksum) ||
    typeof metadata?.fileSize !== "string" ||
    !/^\d+$/.test(metadata.fileSize) ||
    Number(metadata.fileSize) <= 0 ||
    Number(metadata.fileSize) > MAX_WORKBOOK_BYTES
  ) {
    throw new Error(
      "Google snapshot metadata lacks a valid binary revision and strong ETag",
    );
  }
  return metadata as DriveMetadata;
}

export class GoogleDriveClient {
  constructor(
    readonly accessToken: string,
    readonly fetcher: Fetcher = fetch,
    readonly pause: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}
  async metadata(fileId: string): Promise<DriveMetadata> {
    const fields =
      "id,mimeType,etag,version,headRevisionId,md5Checksum,fileSize,labels(trashed)";
    const url = `https://www.googleapis.com/drive/v2/files/${
      encodeURIComponent(fileId)
    }?${new URLSearchParams({ fields, supportsAllDrives: "true" })}`;
    const { bytes } = await checkedFetch(this.fetcher, "google_drive", url, {
      headers: { authorization: `Bearer ${this.accessToken}` },
    }, 1024 * 1024);
    try {
      return validateMetadata(
        JSON.parse(new TextDecoder().decode(bytes)),
        fileId,
      );
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Google metadata returned invalid JSON");
      }
      throw error;
    }
  }
  async downloadStable(fileId: string): Promise<StableSnapshot> {
    let reason = "unknown";
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.metadata(fileId);
      const url = `https://www.googleapis.com/drive/v3/files/${
        encodeURIComponent(fileId)
      }?alt=media&supportsAllDrives=true`;
      const { bytes } = await checkedFetch(this.fetcher, "google_drive", url, {
        headers: { authorization: `Bearer ${this.accessToken}` },
      }, MAX_WORKBOOK_BYTES);
      const after = await this.metadata(fileId);
      if (
        before.id !== after.id || before.mimeType !== after.mimeType ||
        before.etag !== after.etag || before.version !== after.version ||
        before.headRevisionId !== after.headRevisionId ||
        before.md5Checksum !== after.md5Checksum ||
        before.fileSize !== after.fileSize ||
        before.labels.trashed !== after.labels.trashed
      ) reason = "metadata_changed";
      else if (
        bytes.length !== Number(before.fileSize) ||
        md5Hex(bytes) !== before.md5Checksum.toLowerCase()
      ) reason = "checksum_or_size_mismatch";
      else return { bytes, metadata: before };
      if (attempt < 2) await this.pause(250 * (attempt + 1));
    }
    throw new GoogleSnapshotUnstable(
      `Workbook snapshot did not stabilize after three complete reads (${reason}); no stable snapshot or write`,
    );
  }
  async uploadConditional(
    fileId: string,
    bytes: Uint8Array,
    etag: string,
  ): Promise<void> {
    if (!strongEtag(etag)) {
      throw new Error(
        "A strong observed ETag is required; conditional overwrite is unavailable",
      );
    }
    if (!bytes.length || bytes.length > MAX_WORKBOOK_BYTES) {
      throw new Error("Workbook upload exceeds allowed bounds");
    }
    const url = `https://www.googleapis.com/upload/drive/v2/files/${
      encodeURIComponent(fileId)
    }?uploadType=media&supportsAllDrives=true`;
    await checkedFetch(this.fetcher, "google_drive", url, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        "content-type": XLSX,
        "If-Match": etag,
      },
      body: Uint8Array.from(bytes).buffer,
    }, 1024 * 1024);
  }
}
