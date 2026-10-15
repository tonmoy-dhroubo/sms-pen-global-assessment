import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "@/lib/storage-token";
import type { DownloadClaims, UploadClaims } from "@/lib/storage-token";

const SECRET = "unit-test-secret-that-is-at-least-32-characters";
const NOW = new Date("2026-10-15T10:00:00Z");
const IN_15_MIN = NOW.getTime() + 15 * 60_000;

const upload: UploadClaims = {
  typ: "put",
  key: "pending/a/b/c.pdf",
  ct: "application/pdf",
  len: 1234,
  exp: IN_15_MIN,
};
const download: DownloadClaims = {
  typ: "get",
  key: "submissions/a/b/c.pdf",
  name: "প্রতিবেদন.pdf",
  exp: IN_15_MIN,
};

describe("signToken and verifyToken", () => {
  it("round-trips upload and download claims, including a non-ASCII name", () => {
    expect(verifyToken(signToken(upload, SECRET), SECRET, NOW)).toEqual({
      ok: true,
      claims: upload,
    });
    expect(verifyToken(signToken(download, SECRET), SECRET, NOW)).toEqual({
      ok: true,
      claims: download,
    });
  });

  it("makes a token that is safe in a URL path", () => {
    expect(signToken(download, SECRET)).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("rejects a token signed with another secret", () => {
    const token = signToken(upload, SECRET);
    expect(verifyToken(token, "another-secret-that-is-also-32-chars-long", NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("rejects a token whose claims were edited (a different key, length, type or expiry)", () => {
    const [version, , signature] = signToken(upload, SECRET).split(".") as [string, string, string];
    const edits: Partial<UploadClaims>[] = [
      { key: "pending/a/b/other.pdf" },
      { key: "submissions/a/b/c.pdf" },
      { len: 1 },
      { ct: "text/html" },
      { exp: IN_15_MIN + 86_400_000 },
    ];
    for (const edit of edits) {
      const payload = Buffer.from(JSON.stringify({ ...upload, ...edit })).toString("base64url");
      expect(verifyToken(`${version}.${payload}.${signature}`, SECRET, NOW)).toEqual({
        ok: false,
        reason: "signature",
      });
    }
  });

  it("rejects a flipped signature byte", () => {
    const token = signToken(upload, SECRET);
    const last = token.slice(-1);
    const tampered = token.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(verifyToken(tampered, SECRET, NOW)).toMatchObject({ ok: false });
  });

  it("rejects an expired token, exactly at the expiry and after it", () => {
    const token = signToken(upload, SECRET);
    expect(verifyToken(token, SECRET, new Date(IN_15_MIN - 1))).toMatchObject({ ok: true });
    expect(verifyToken(token, SECRET, new Date(IN_15_MIN))).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(verifyToken(token, SECRET, new Date(IN_15_MIN + 60_000))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it.each(["", "garbage", "v1.a", "v1.a.b.c", "v2.a.b", "...", "v1..", "../../etc/passwd"])(
    "rejects %j as malformed or unsigned",
    (token) => {
      expect(verifyToken(token, SECRET, NOW)).toMatchObject({ ok: false });
    },
  );

  it("rejects a correctly signed payload that is not a claims object", () => {
    // Signed by us (so the signature is valid) but nonsense: never trusted.
    for (const payload of ['"text"', "null", '{"typ":"put"}', '{"typ":"x","key":"k","exp":1}']) {
      const token = signToken(JSON.parse(payload) as never, SECRET);
      expect(verifyToken(token, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("does not accept the session cookie's signature as a storage token (domain separation)", () => {
    const payload = Buffer.from(JSON.stringify(upload)).toString("base64url");
    const naive = createHmac("sha256", SECRET).update(`v1.${payload}`).digest("base64url");
    expect(verifyToken(`v1.${payload}.${naive}`, SECRET, NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
  });
});
