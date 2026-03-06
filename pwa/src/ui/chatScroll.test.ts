import { describe, expect, it } from "vitest";
import { decideAutoScroll } from "./chatScroll";

describe("chat auto-scroll behavior", () => {
  it("forces scroll after a user send", () => {
    const decision = decideAutoScroll({
      isNearBottom: false,
      pendingUserSend: true,
      latestRole: "president",
      latestType: "user"
    });
    expect(decision.shouldScroll).toBe(true);
    expect(decision.behavior).toBe("auto");
    expect(decision.clearPending).toBe(true);
  });

  it("does not yank scroll when user is reading older messages", () => {
    const decision = decideAutoScroll({
      isNearBottom: false,
      pendingUserSend: false,
      latestRole: "secretary_phi",
      latestType: "informational_answer"
    });
    expect(decision.shouldScroll).toBe(false);
  });

  it("smooth-scrolls assistant replies when already near bottom", () => {
    const decision = decideAutoScroll({
      isNearBottom: true,
      pendingUserSend: false,
      latestRole: "secretary_phi",
      latestType: "informational_answer"
    });
    expect(decision.shouldScroll).toBe(true);
    expect(decision.behavior).toBe("smooth");
  });
});
