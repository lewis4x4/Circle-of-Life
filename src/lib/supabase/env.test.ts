import { describe, expect, it } from "vitest";
import { supabaseCspOrigins } from "./env";

describe("Supabase CSP origin boundary", () => {
  it("retains exact production HTTPS/WSS origin without path/query text", () => {
    expect(supabaseCspOrigins("https://example.supabase.co/path?x=1")).toEqual({ http: "https://example.supabase.co", websocket: "wss://example.supabase.co" });
  });
  it.each(["127.0.0.1", "localhost"])("permits local Auth HTTP and WS for %s", host => {
    expect(supabaseCspOrigins(`http://${host}:59321`)).toEqual({ http: `http://${host}:59321`, websocket: `ws://${host}:59321` });
  });
  it.each(["http://[::1]:59321", "https://[::1]:59321", "http://example.supabase.co", "http://127.0.0.1.example.com", "ftp://localhost", "javascript:alert(1)"])("rejects unsafe configured origin %s", value => {
    expect(() => supabaseCspOrigins(value)).toThrow();
  });
  it("keeps an unconfigured backend absent from CSP", () => expect(supabaseCspOrigins(undefined)).toEqual({ http: "", websocket: "" }));
});
