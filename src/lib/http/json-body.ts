import { NextResponse } from "next/server";

export type ParsedJsonBody<T> =
  | { data: T; response?: never }
  | { data?: never; response: NextResponse };

export async function parseJsonBody<T>(request: Request): Promise<ParsedJsonBody<T>> {
  try {
    return { data: (await request.json()) as T };
  } catch {
    return {
      response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
    };
  }
}
