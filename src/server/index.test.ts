import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Chat } from './index';
import { env } from "cloudflare:test";

describe('Chat.saveMessage', () => {
  let chat: Chat;
  let execMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    execMock = vi.fn();
    const mockCtx = {
      storage: {
        sql: {
          exec: execMock,
        }
      }
    };
    // Since we need to inherit from Server which extends DurableObject we'll just test the saveMessage logic natively
    // Let's create a stub implementation for testing saveMessage

    chat = Object.create(Chat.prototype);
    chat.ctx = mockCtx as any;
    chat.messages = [];
  });

  it('adds a new message when it does not exist', () => {
    const newMessage = { id: '1', user: 'Alice', role: 'user', content: 'Hello' } as const;
    chat.saveMessage(newMessage);

    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toEqual(newMessage);
    expect(execMock).toHaveBeenCalledWith(
      `INSERT INTO messages (id, user, role, content) VALUES ('1', 'Alice', 'user', "Hello") ON CONFLICT (id) DO UPDATE SET content = "Hello"`
    );
  });

  it('updates an existing message when it already exists', () => {
    chat.messages = [
      { id: '1', user: 'Alice', role: 'user', content: 'Hello' },
      { id: '2', user: 'Bob', role: 'assistant', content: 'Hi' }
    ];

    const updatedMessage = { id: '1', user: 'Alice', role: 'user', content: 'Hello updated' } as const;
    chat.saveMessage(updatedMessage);

    expect(chat.messages).toHaveLength(2);
    expect(chat.messages.find(m => m.id === '1')).toEqual(updatedMessage);
    expect(execMock).toHaveBeenCalledWith(
      `INSERT INTO messages (id, user, role, content) VALUES ('1', 'Alice', 'user', "Hello updated") ON CONFLICT (id) DO UPDATE SET content = "Hello updated"`
    );
  });
});
