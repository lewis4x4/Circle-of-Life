"use client";

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEMO_MODE_STORAGE_KEY } from "@/lib/demo-mode";
import { useClientDemoMode } from "./useClientDemoMode";

const ORIGINAL_DEMO_ENV = process.env.NEXT_PUBLIC_DEMO_MODE;

beforeEach(() => {
  localStorage.removeItem(DEMO_MODE_STORAGE_KEY);
});

afterEach(() => {
  if (ORIGINAL_DEMO_ENV === undefined) {
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
  } else {
    process.env.NEXT_PUBLIC_DEMO_MODE = ORIGINAL_DEMO_ENV;
  }
});

describe("useClientDemoMode", () => {
  it("reflects localStorage opt-out after env enables demo", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, "false");

    const { result } = renderHook(() => useClientDemoMode());
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("is true after mount when env enables demo and storage does not opt out", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";

    const { result } = renderHook(() => useClientDemoMode());
    await waitFor(() => expect(result.current).toBe(true));
  });
});
