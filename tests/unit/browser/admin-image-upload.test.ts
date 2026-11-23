import { afterEach, describe, expect, it, vi } from "vitest";
import { sendImage } from "../../../apps/admin/src/components/image-upload";

/** A stand-in for the browser's XMLHttpRequest that the test drives by hand. */
class FakeXhr {
  static last: FakeXhr;
  upload: {
    onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
  } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = "";
  sent: unknown = null;
  headers: Record<string, string> = {};
  aborted = false;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.headers[":method"] = method;
    this.headers[":url"] = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.sent = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("image upload with progress and cancel (admin)", () => {
  it("reports how much is sent and returns the server's answer", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const seen: number[] = [];
    const done = sendImage("/api/uploads/banner", "BODY", "image/webp", (p) => seen.push(p));
    const xhr = FakeXhr.last;
    expect(xhr.headers).toMatchObject({ ":method": "POST", ":url": "/api/uploads/banner" });
    expect(xhr.headers["content-type"]).toBe("image/webp");
    xhr.upload.onprogress?.({ loaded: 25, total: 100, lengthComputable: true });
    xhr.upload.onprogress?.({ loaded: 100, total: 100, lengthComputable: true });
    xhr.status = 201;
    xhr.responseText = JSON.stringify({ url: "https://cdn/x.webp" });
    xhr.onload?.();
    await expect(done).resolves.toEqual({ ok: true, data: { url: "https://cdn/x.webp" } });
    expect(seen).toEqual([0.25, 1]);
  });

  it("stops the upload when cancelled (X)", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const controller = new AbortController();
    const done = sendImage("/api/uploads/logo", "BODY", "image/png", () => {}, controller.signal);
    controller.abort();
    await expect(done).resolves.toBe("cancelled");
    expect(FakeXhr.last.aborted).toBe(true);
  });

  it("does not start when already cancelled, and fails on a network error", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const controller = new AbortController();
    controller.abort();
    await expect(
      sendImage("/api/uploads/logo", "BODY", "image/png", () => {}, controller.signal),
    ).resolves.toBe("cancelled");
    const failing = sendImage("/api/uploads/logo", "BODY", "image/png", () => {});
    FakeXhr.last.onerror?.();
    await expect(failing).rejects.toThrow();
  });
});
