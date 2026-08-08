import { describe, it, expect, vi } from 'vitest';
import { Chat } from './index';

// We need to mock partyserver so we don't import Cloudflare worker specific imports
vi.mock('partyserver', () => {
  return {
    Server: class MockServer {
      ctx: any;
      env: any;
      constructor(ctx: any, env: any) {
        this.ctx = ctx;
        this.env = env;
      }
      broadcast() {}
    },
    routePartykitRequest: vi.fn(),
  };
});

describe('Chat Server', () => {
  describe('broadcastMessage', () => {
    it('should call this.broadcast with stringified message', () => {
      // Create a dummy Chat instance
      // The Server constructor typically takes a context and env. We can pass dummies.
      const dummyCtx: any = {
        storage: { sql: { exec: vi.fn().mockReturnValue({ toArray: vi.fn().mockReturnValue([]) }) } }
      };
      const dummyEnv: any = {};

      const chat = new Chat(dummyCtx, dummyEnv);

      // Mock the broadcast method on the instance
      chat.broadcast = vi.fn();

      const message: any = { type: 'add', id: '1', content: 'hello', user: 'user1', role: 'user' };

      chat.broadcastMessage(message);

      expect(chat.broadcast).toHaveBeenCalledWith(JSON.stringify(message), undefined);
    });

    it('should call this.broadcast with stringified message and exclude parameter', () => {
      const dummyCtx: any = {
        storage: { sql: { exec: vi.fn().mockReturnValue({ toArray: vi.fn().mockReturnValue([]) }) } }
      };
      const dummyEnv: any = {};

      const chat = new Chat(dummyCtx, dummyEnv);

      chat.broadcast = vi.fn();

      const message: any = { type: 'add', id: '1', content: 'hello', user: 'user1', role: 'user' };
      const exclude = ['conn1', 'conn2'];

      chat.broadcastMessage(message, exclude);

      expect(chat.broadcast).toHaveBeenCalledWith(JSON.stringify(message), exclude);
    });
  });
});
