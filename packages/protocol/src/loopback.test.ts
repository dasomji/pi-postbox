import { describe, expect, it } from "vitest";
import { normalizeLoopbackUrl } from "./loopback.js";

describe("safe profile metadata URLs", () => {
  it.each([
    ["http://127.0.0.1:32187", "http://127.0.0.1:32187/"],
    ["https://127.12.34.56:443/", "https://127.12.34.56:443/"],
    ["http://[::1]:43123/", "http://[::1]:43123/"]
  ])("normalizes numeric loopback URL %s", (input, expected) => {
    expect(normalizeLoopbackUrl(input)).toMatchObject({ ok: true, url: expected });
  });

  it.each([
    "http://localhost:32187/",
    "http://127.evil.test:32187/",
    "http://0.0.0.0:32187/",
    "http://127.0.0.1:32187/path",
    "http://user@127.0.0.1:32187/"
  ])("rejects unsafe metadata URL %s", (input) => {
    expect(normalizeLoopbackUrl(input)).toMatchObject({ ok: false });
  });
});
