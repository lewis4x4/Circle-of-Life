import { describe, expect, it } from "vitest";

import { formatBytes } from "./workspace-files";
import { WORKSPACE_FILE_NO_SIZE_COPY } from "./workspace-files-display-copy";

const EM_DASH = "—";

describe("formatBytes", () => {
  it("names a missing size instead of a silent em dash", () => {
    expect(formatBytes(null)).toBe(WORKSPACE_FILE_NO_SIZE_COPY);
    expect(formatBytes(null)).not.toBe(EM_DASH);
  });

  it("keeps zero bytes as 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats posted byte sizes unchanged", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
