import { describe, expect, it } from "vitest";

import { Md5, md5Hex, md5OfBlob } from "./md5";

const bytes = (text: string) => new TextEncoder().encode(text);

/** RFC 1321 section A.5 test suite. */
const RFC_VECTORS: Array<[string, string]> = [
  ["", "d41d8cd98f00b204e9800998ecf8427e"],
  ["a", "0cc175b9c0f1b6a831c399e269772661"],
  ["abc", "900150983cd24fb0d6963f7d28e17f72"],
  ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
  ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
  ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "d174ab98d277d9f5a5611c2c9f419d9f"],
  ["12345678901234567890123456789012345678901234567890123456789012345678901234567890", "57edf4a22be3c955ac49da2e2107b67a"],
];

describe("md5", () => {
  it("matches the RFC 1321 test vectors", () => {
    for (const [input, digest] of RFC_VECTORS) expect(md5Hex(bytes(input))).toBe(digest);
  });

  it("produces the same digest whether the bytes arrive at once or in chunks of any size", () => {
    const input = new Uint8Array(1000);
    for (let i = 0; i < input.length; i += 1) input[i] = (i * 31 + 7) & 0xff;
    const whole = md5Hex(input);
    expect(whole).toBe("2b1e78d5765de9e10495a01412a1cf22");
    for (const chunkSize of [1, 3, 63, 64, 65, 128, 999]) {
      const hash = new Md5();
      for (let offset = 0; offset < input.length; offset += chunkSize) hash.update(input.subarray(offset, offset + chunkSize));
      expect(hash.hex()).toBe(whole);
    }
  });

  it("pads correctly around the block boundaries", () => {
    const lengths: Array<[number, string]> = [
      [55, "ef1772b6dff9a122358552954ad0df65"],
      [56, "3b0c8ac703f828b04c6c197006d17218"],
      [63, "b06521f39153d618550606be297466d5"],
      [64, "014842d480b571495a4a0363793f7367"],
      [119, "8a7bd0732ed6a28ce75f6dabc90e1613"],
      [120, "5f61c0ccad4cac44c75ff505e1f1e537"],
    ];
    for (const [length, digest] of lengths) expect(md5Hex(bytes("a".repeat(length)))).toBe(digest);
    expect(md5Hex(new Uint8Array(55))).toBe("c9ea3314b91c9fd4e38f9432064fd1f2");
  });

  it("refuses to be updated after the digest is produced and formats lowercase hex", () => {
    const hash = new Md5().update(bytes("abc"));
    expect(hash.hex()).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(() => hash.update(bytes("d"))).toThrow();
    expect(md5Hex(bytes("abc"))).toMatch(/^[0-9a-f]{32}$/);
  });

  it("hashes a Blob chunk by chunk to the same digest as the whole", async () => {
    const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".repeat(40);
    const blob = new Blob([bytes(text)], { type: "image/jpeg" });
    const whole = md5Hex(bytes(text));
    expect(whole).toBe("3a7010b1102efbd5d3b806d16dc9b2c1");
    expect(await md5OfBlob(blob, 7)).toBe(whole);
    expect(await md5OfBlob(blob, 1024)).toBe(whole);
    expect(await md5OfBlob(blob)).toBe(whole);
    expect(await md5OfBlob(new Blob([]))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    await expect(md5OfBlob(blob, 0)).rejects.toThrow();
  });
});
