import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Chat } from './index';
import type { Connection } from 'partyserver';

describe('Chat.onMessage', () => {
  let chat: Chat;
  let mockConnection: Connection;

  beforeEach(() => {
    chat = new Chat({} as any, {} as any);
    chat.broadcast = vi.fn();
    chat.saveMessage = vi.fn();
    mockConnection = {} as Connection;
  });

  it('should broadcast raw message and save if type is "add"', () => {
    const addMessage = JSON.stringify({ type: 'add', id: '1', content: 'hello', user: 'alice', role: 'user' });
    chat.onMessage(mockConnection, addMessage);

    expect(chat.broadcast).toHaveBeenCalledWith(addMessage);
    expect(chat.saveMessage).toHaveBeenCalledWith(JSON.parse(addMessage));
  });

  it('should broadcast raw message and save if type is "update"', () => {
    const updateMessage = JSON.stringify({ type: 'update', id: '2', content: 'world', user: 'bob', role: 'user' });
    chat.onMessage(mockConnection, updateMessage);

    expect(chat.broadcast).toHaveBeenCalledWith(updateMessage);
    expect(chat.saveMessage).toHaveBeenCalledWith(JSON.parse(updateMessage));
  });

  it('should broadcast raw message but NOT save if type is other', () => {
    const otherMessage = JSON.stringify({ type: 'all', messages: [] });
    chat.onMessage(mockConnection, otherMessage);

    expect(chat.broadcast).toHaveBeenCalledWith(otherMessage);
    expect(chat.saveMessage).not.toHaveBeenCalled();
  });
});
