export interface ScrollDecisionInput {
  isNearBottom: boolean;
  pendingUserSend: boolean;
  latestRole?: string;
  latestType?: string;
}

export interface ScrollDecision {
  shouldScroll: boolean;
  behavior: ScrollBehavior;
  clearPending: boolean;
}

export const decideAutoScroll = (input: ScrollDecisionInput): ScrollDecision => {
  const isLatestUserMessage = input.latestRole === "president" || input.latestType === "user";
  const forceScroll = input.pendingUserSend || isLatestUserMessage;
  if (forceScroll) {
    return {
      shouldScroll: true,
      behavior: "auto",
      clearPending: true
    };
  }
  if (!input.isNearBottom) {
    return {
      shouldScroll: false,
      behavior: "auto",
      clearPending: false
    };
  }
  return {
    shouldScroll: true,
    behavior: "smooth",
    clearPending: false
  };
};
