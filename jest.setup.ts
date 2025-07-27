import "@testing-library/jest-dom";
import "whatwg-fetch";

// Polyfill TextEncoder/TextDecoder for msw in Node
import { TextEncoder, TextDecoder } from "util";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
global.TextEncoder = TextEncoder;
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
global.TextDecoder = TextDecoder;

// MSW server is not needed for current tests but kept for future use
// If request handlers are added, uncomment the following lines:
// import { server } from "./test/server";
// beforeAll(() => server.listen());
// afterEach(() => server.resetHandlers());
// afterAll(() => server.close());
