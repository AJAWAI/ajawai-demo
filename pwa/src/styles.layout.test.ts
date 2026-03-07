import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "styles.css"), "utf8");

describe("chat layout CSS guards", () => {
  it("keeps message list scrollable", () => {
    expect(css).toMatch(/\.chat-thread[\s\S]*overflow-y:\s*auto;/);
    expect(css).toMatch(/\.chat-layout[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s*auto;/);
  });

  it("prevents composer overlap by avoiding sticky composer positioning", () => {
    expect(css).toMatch(/\.chat-composer[\s\S]*display:\s*grid;/);
    expect(css).not.toMatch(/\.chat-composer[\s\S]*position:\s*sticky;/);
  });

  it("ensures long messages wrap and remain readable", () => {
    expect(css).toMatch(/\.chat-message-text[\s\S]*white-space:\s*pre-wrap;/);
    expect(css).toMatch(/\.chat-message-text[\s\S]*overflow-wrap:\s*anywhere;/);
  });
});
