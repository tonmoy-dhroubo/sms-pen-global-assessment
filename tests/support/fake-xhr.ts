// Test double for XMLHttpRequest, the browser API the upload uses for progress (lib/client/submissions.ts).

type ProgressEvent = { lengthComputable: boolean; loaded: number; total: number };

/** A stand-in for XMLHttpRequest that tests drive by hand: `progress()`, `finish(status)`, `fail()`. */
export class FakeXhr {
  static instances: FakeXhr[] = [];
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  aborted = false;

  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({ lengthComputable, loaded, total });
  }
  finish(status: number) {
    this.status = status;
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}
