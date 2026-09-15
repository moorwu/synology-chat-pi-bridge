import { test, expect } from "bun:test";
import { JsonlFramer } from "./jsonl";

test("splits on LF", () => {
  const framer = new JsonlFramer();
  const lines = framer.push('{"a":1}\n{"b":2}\n');
  expect(lines).toEqual(['{"a":1}', '{"b":2}']);
});

test("handles \\r\\n (Windows)", () => {
  const framer = new JsonlFramer();
  const lines = framer.push('{"a":1}\r\n{"b":2}\r\n');
  expect(lines).toEqual(['{"a":1}', '{"b":2}']);
});

test("does NOT split on U+2028 (LINE SEPARATOR)", () => {
  const framer = new JsonlFramer();
  // U+2028 inside a JSON string — must use fromCharCode because
  // Bun/JS parsers treat \u2028 as a source-level line terminator
  const ls = String.fromCharCode(0x2028);
  const payload = '{"text":"hello' + ls + 'world"}';
  const lines = framer.push(payload + '\n{"b":2}\n');
  expect(lines).toEqual([payload, '{"b":2}']);
});

test("does NOT split on U+2029 (PARAGRAPH SEPARATOR)", () => {
  const framer = new JsonlFramer();
  const ps = String.fromCharCode(0x2029);
  const payload = '{"text":"para' + ps + 'graph"}';
  const lines = framer.push(payload + '\n{"b":2}\n');
  expect(lines).toEqual([payload, '{"b":2}']);
});

test("buffers partial lines", () => {
  const framer = new JsonlFramer();
  const lines = framer.push('{"a":1}\n{"b":');
  expect(lines).toEqual(['{"a":1}']);
  expect(framer["buffer"]).toBe('{"b":');
});

test("completes partial line on next push, buffers unterminated last line", () => {
  const framer = new JsonlFramer();
  framer.push('{"a":1}\n{"b":');
  // "2}\n{"c":3}" — split on \n: '{"b":2}' completes, '{"c":3}' stays in buffer
  const lines = framer.push('2}\n{"c":3}');
  expect(lines).toEqual(['{"b":2}']);
  // '{"c":3}' is unterminated, still in buffer
  expect(framer["buffer"]).toBe('{"c":3}');
});

test("flush returns remaining buffer", () => {
  const framer = new JsonlFramer();
  framer.push('{"a":1}\n{"b":');
  const lines = framer.flush();
  expect(lines).toEqual(['{"b":']);
});

test("flush on empty buffer returns empty array", () => {
  const framer = new JsonlFramer();
  framer.push('{"a":1}\n');
  const lines = framer.flush();
  expect(lines).toEqual([]);
});

test("skips empty lines", () => {
  const framer = new JsonlFramer();
  const lines = framer.push('\n{"a":1}\n\n{"b":2}\n\n');
  expect(lines).toEqual(['{"a":1}', '{"b":2}']);
});

test("handles chunked delivery (many small pushes)", () => {
  const framer = new JsonlFramer();
  const input = '{"msg":"hello"}\n{"msg":"world"}\n';
  const results: string[] = [];
  for (let i = 0; i < input.length; i++) {
    results.push(...framer.push(input[i]));
  }
  expect(results).toEqual(['{"msg":"hello"}', '{"msg":"world"}']);
});

test("handles newlines in JSON strings correctly", () => {
  const framer = new JsonlFramer();
  const lines = framer.push('{"text":"line1\\nline2"}\n{"b":2}\n');
  expect(lines).toEqual(['{"text":"line1\\nline2"}', '{"b":2}']);
});

test("reset clears buffer", () => {
  const framer = new JsonlFramer();
  framer.push('{"partial":');
  framer.reset();
  const lines = framer.flush();
  expect(lines).toEqual([]);
});
