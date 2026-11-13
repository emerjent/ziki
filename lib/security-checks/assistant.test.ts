import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { askSecurityAssistant } from "./assistant";

describe("askSecurityAssistant (#security-checks, plan C3)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns nothing without Ziki's Claude key, so the chat asks plainly", async () => {
    vi.stubEnv("ZIKI_CLAUDE_API_KEY", "");
    expect(await askSecurityAssistant([{ role: "user", text: "I want to secure my site" }])).toBeNull();
  });

  it("only answers when the client spoke last", async () => {
    vi.stubEnv("ZIKI_CLAUDE_API_KEY", "test-key-not-real");
    expect(await askSecurityAssistant([{ role: "assistant", text: "What do you want to secure?" }])).toBeNull();
    expect(await askSecurityAssistant([])).toBeNull();
  });
});
