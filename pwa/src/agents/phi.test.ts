import { describe, expect, it } from "vitest";
import {
  chooseResponseMode,
  decideToolNeed,
  isRecipeQualityResponse,
  isTemplateLikeReply,
  shouldUseWebSearch
} from "./phi";

describe("Secretary Phi routing and quality guards", () => {
  it("routes unknown non-tool prompts to LLM path", () => {
    const plan = decideToolNeed("What is life");
    expect(plan.useTool).toBe(false);
    expect(plan.intent).toBe("conversational");
  });

  it("selects comprehensive mode for broad prompts", () => {
    expect(chooseResponseMode("What can ai do for humanity")).toBe("comprehensive");
    expect(chooseResponseMode("Explain consciousness in depth")).toBe("comprehensive");
  });

  it("selects structured mode for recipe prompts", () => {
    expect(chooseResponseMode("How to make an apple fritter")).toBe("structured");
  });

  it("flags template-like responses", () => {
    expect(isTemplateLikeReply("I can help with What can ai do for humanity.")).toBe(true);
    expect(
      isTemplateLikeReply("Absolutely — here is a practical a apple fritter recipe template...")
    ).toBe(true);
  });

  it("validates real recipe output and rejects placeholders", () => {
    const realRecipe = [
      "Apple Fritter Recipe",
      "Servings: 6",
      "Ingredients:",
      "- 2 cups flour",
      "- 1 tsp baking powder",
      "- 1/2 tsp cinnamon",
      "- 3/4 cup milk",
      "- 2 apples, diced",
      "Instructions:",
      "1) Heat oil to 350°F.",
      "2) Mix dry ingredients and milk.",
      "3) Fold in apples and fry 2-3 minutes per side.",
      "4) Drain and glaze."
    ].join("\n");
    const placeholderRecipe = [
      "Ingredients:",
      "- main ingredient(s)",
      "- seasoning",
      "Steps:",
      "1) Cook",
      "2) Serve"
    ].join("\n");

    expect(isRecipeQualityResponse(realRecipe)).toBe(true);
    expect(isRecipeQualityResponse(placeholderRecipe)).toBe(false);
  });

  it("bypasses search for translation and enables it for current-facts prompts", () => {
    expect(shouldUseWebSearch("Translate how are you into Spanish")).toBe(false);
    expect(shouldUseWebSearch("Who is the richest person in the world right now?")).toBe(true);
  });
});
