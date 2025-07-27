import "@testing-library/jest-dom";

// Polyfill TextEncoder/TextDecoder for msw in Node
import { TextEncoder, TextDecoder } from "util";
import { TransformStream } from "stream/web";

// Simple in-memory localStorage mock
class LocalStorageMock {
  private store: Record<string, string> = {};
  clear() {
    this.store = {};
  }
  getItem(key: string) {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string) {
    this.store[key] = value;
  }
  removeItem(key: string) {
    delete this.store[key];
  }
}

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
global.TextEncoder = TextEncoder;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
global.TextDecoder = TextDecoder;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
global.TransformStream = TransformStream;
// Provide localStorage in Node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
global.localStorage = new LocalStorageMock();

// Polyfill BroadcastChannel for msw in Node
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
global.BroadcastChannel = class {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_: string | undefined) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  postMessage(_: unknown) {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
};

// MSW server is not needed for current tests but kept for future use
// If request handlers are added, uncomment the following lines:
// import { server } from "./test/server";
// beforeAll(() => server.listen());
// afterEach(() => server.resetHandlers());
// afterAll(() => server.close());
