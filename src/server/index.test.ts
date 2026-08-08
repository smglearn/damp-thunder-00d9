import { describe, it, expect, vi } from "vitest";

vi.mock("partyserver", () => {
  return {
    Server: class {
      ctx: any;
      env: any;
      constructor(ctx: any, env: any) {
        this.ctx = ctx;
        this.env = env;
      }
      broadcast(msg: any) {}
    },
    routePartykitRequest: vi.fn(),
  };
});

import { Chat } from "./index";

describe("Chat Server", () => {
  it("should handle invalid JSON gracefully in onMessage", () => {
    const chat = new Chat({} as any, {} as any);
    chat.broadcast = vi.fn();
    chat.saveMessage = vi.fn();

    const connection = {} as any;
    const invalidJsonMessage = "invalid-json";

    // Call onMessage and expect it not to throw
    expect(() => chat.onMessage(connection, invalidJsonMessage)).not.toThrow();
  });
});
