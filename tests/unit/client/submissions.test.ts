import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageUploadError, uploadToStorage } from "@/lib/client/submissions";
import { FakeXhr } from "../../support/fake-xhr";

// uploadToStorage drives XMLHttpRequest (the only browser API with upload progress), so it is tested against a fake one.

beforeEach(() => {
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});
afterEach(() => vi.unstubAllGlobals());

const file = new Blob(["%PDF-1.7 hello"], { type: "application/pdf" });
const options = {
  url: "http://storage.test/bucket/key.pdf?X-Amz-Signature=abc",
  headers: { "Content-Type": "application/pdf" },
  file,
};

describe("uploadToStorage", () => {
  it("PUTs the file to the URL with exactly the headers it was given", async () => {
    const done = uploadToStorage(options);
    const xhr = FakeXhr.instances[0]!;
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe(options.url);
    expect(xhr.headers).toEqual({ "Content-Type": "application/pdf" });
    expect(xhr.body).toBe(file);
    xhr.finish(200);
    await expect(done).resolves.toBeUndefined();
  });

  it("reports progress as a whole percentage and ends at 100", async () => {
    const seen: number[] = [];
    const done = uploadToStorage({ ...options, onProgress: (percent) => seen.push(percent) });
    const xhr = FakeXhr.instances[0]!;
    xhr.progress(0, 200);
    xhr.progress(50, 200);
    xhr.progress(133, 200);
    xhr.progress(10, 0, false); // not computable: ignored
    xhr.finish(200);
    await done;
    expect(seen).toEqual([0, 25, 67, 100]);
  });

  it("rejects with a clear message when storage refuses (403)", async () => {
    const done = uploadToStorage(options);
    FakeXhr.instances[0]!.finish(403);
    const error = await done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageUploadError);
    expect(error).toMatchObject({ kind: "refused", status: 403 });
    expect((error as Error).message).toMatch(/refused the file/);
  });

  it("rejects with the status for other errors", async () => {
    const done = uploadToStorage(options);
    FakeXhr.instances[0]!.finish(500);
    await expect(done).rejects.toMatchObject({ kind: "refused", status: 500 });
  });

  it("rejects as a network error when the connection drops", async () => {
    const done = uploadToStorage(options);
    FakeXhr.instances[0]!.fail();
    await expect(done).rejects.toMatchObject({ kind: "network" });
  });

  it("aborts the request when the signal fires", async () => {
    const controller = new AbortController();
    const done = uploadToStorage({ ...options, signal: controller.signal });
    controller.abort();
    await expect(done).rejects.toMatchObject({ kind: "aborted" });
    expect(FakeXhr.instances[0]!.aborted).toBe(true);
  });

  it("does not send anything when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(uploadToStorage({ ...options, signal: controller.signal })).rejects.toMatchObject({
      kind: "aborted",
    });
    expect(FakeXhr.instances[0]!.body).toBeUndefined();
  });
});
