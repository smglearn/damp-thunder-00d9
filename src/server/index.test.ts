import { describe, it, expect, vi } from 'vitest';

vi.mock('partyserver', () => {
  return {
    Server: class Server {
      ctx: any;
      constructor(ctx: any) {
        this.ctx = ctx;
      }
    },
    routePartykitRequest: vi.fn(),
  };
});

import { Chat } from './index';
import type { ChatMessage } from '../shared';

describe('Chat onStart', () => {
  it('should initialize the database and load messages when messages exist', () => {
    const mockMessages: ChatMessage[] = [
      { id: '1', user: 'Alice', role: 'user', content: 'hello' }
    ];

    const mockExec = vi.fn((query: string) => {
      if (query.includes('SELECT')) {
        return { toArray: () => mockMessages };
      }
      return { toArray: () => [] };
    });

    const chat = new Chat({} as any, {} as any);
    // Use type casting to bypass the protected modifier for testing
    (chat as any).ctx = {
      storage: {
        sql: {
          exec: mockExec
        }
      }
    } as any;

    chat.onStart();

    expect(mockExec).toHaveBeenCalledWith(
      `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT)`
    );
    expect(mockExec).toHaveBeenCalledWith(`SELECT * FROM messages`);
    expect(chat.messages).toEqual(mockMessages);
  });

  it('should handle initializing the database when no messages exist', () => {
    const mockExec = vi.fn((query: string) => {
      if (query.includes('SELECT')) {
        return { toArray: () => [] };
      }
      return { toArray: () => [] };
    });

    const chat = new Chat({} as any, {} as any);
    // Use type casting to bypass the protected modifier for testing
    (chat as any).ctx = {
      storage: {
        sql: {
          exec: mockExec
        }
      }
    } as any;

    chat.onStart();

    expect(mockExec).toHaveBeenCalledWith(
      `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT)`
    );
    expect(mockExec).toHaveBeenCalledWith(`SELECT * FROM messages`);
    expect(chat.messages).toEqual([]);
  });
});
