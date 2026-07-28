export type ReplyLimitResult = {
  allowed: boolean;
  replyCount: number;
  maxReplies: number;
};

export class UnregisteredReplyLimiter {
  private readonly replyCounts = new Map<string, number>();

  constructor(private readonly maxReplies: number) {
    if (!Number.isInteger(maxReplies) || maxReplies < 1) {
      throw new Error("maxReplies must be a positive integer");
    }
  }

  claim(senderId: string): ReplyLimitResult {
    const currentCount = this.replyCounts.get(senderId) ?? 0;

    if (currentCount >= this.maxReplies) {
      return {
        allowed: false,
        replyCount: currentCount,
        maxReplies: this.maxReplies,
      };
    }

    const nextCount = currentCount + 1;
    this.replyCounts.set(senderId, nextCount);

    return {
      allowed: true,
      replyCount: nextCount,
      maxReplies: this.maxReplies,
    };
  }

  clear(senderId: string) {
    this.replyCounts.delete(senderId);
  }
}
