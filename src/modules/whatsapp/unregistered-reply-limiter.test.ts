import { describe, expect, test } from "bun:test";

import { UnregisteredReplyLimiter } from "./unregistered-reply-limiter";

describe("UnregisteredReplyLimiter", () => {
  test("allows only the configured number of replies per sender", () => {
    const limiter = new UnregisteredReplyLimiter(3);

    expect(limiter.claim("sender-a")).toMatchObject({
      allowed: true,
      replyCount: 1,
    });
    expect(limiter.claim("sender-a")).toMatchObject({
      allowed: true,
      replyCount: 2,
    });
    expect(limiter.claim("sender-a")).toMatchObject({
      allowed: true,
      replyCount: 3,
    });
    expect(limiter.claim("sender-a")).toEqual({
      allowed: false,
      replyCount: 3,
      maxReplies: 3,
    });
  });

  test("tracks different senders independently", () => {
    const limiter = new UnregisteredReplyLimiter(1);

    expect(limiter.claim("sender-a").allowed).toBe(true);
    expect(limiter.claim("sender-a").allowed).toBe(false);
    expect(limiter.claim("sender-b").allowed).toBe(true);
  });

  test("can clear a sender after successful registration", () => {
    const limiter = new UnregisteredReplyLimiter(1);

    expect(limiter.claim("sender-a").allowed).toBe(true);
    expect(limiter.claim("sender-a").allowed).toBe(false);

    limiter.clear("sender-a");

    expect(limiter.claim("sender-a").allowed).toBe(true);
  });

  test("rejects an invalid maximum", () => {
    expect(() => new UnregisteredReplyLimiter(0)).toThrow();
  });
});
