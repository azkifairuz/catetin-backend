import { describe, expect, test } from "bun:test";

import {
  getWhatsappNumberCandidates,
  normalizeWhatsappNumber,
} from "./whatsapp-number";

describe("normalizeWhatsappNumber", () => {
  test.each([
    ["085155119213", "+6285155119213"],
    ["85155119213", "+6285155119213"],
    ["6285155119213", "+6285155119213"],
    ["+62 851-5511-9213", "+6285155119213"],
    ["6285155119213:4@s.whatsapp.net", "+6285155119213"],
  ])("normalizes %s to E.164", (input, expected) => {
    expect(normalizeWhatsappNumber(input)).toBe(expected);
  });

  test("keeps an explicit international number", () => {
    expect(normalizeWhatsappNumber("+16502530000")).toBe("+16502530000");
  });

  test.each(["", "abc", "16502530000", "123@lid"])(
    "rejects an ambiguous identifier: %s",
    (input) => {
      expect(normalizeWhatsappNumber(input)).toBeNull();
    },
  );
});

test("returns canonical and legacy Indonesian number candidates", () => {
  expect(getWhatsappNumberCandidates("081234567890")).toEqual([
    "+6281234567890",
    "6281234567890",
    "081234567890",
  ]);
});
