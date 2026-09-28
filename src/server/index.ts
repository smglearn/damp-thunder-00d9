import {
  type Connection,
  Server,
  type WSMessage,
  routePartykitRequest,
} from "partyserver";

import type { ChatMessage, Message } from "../shared";

export type ServerChatMessage = ChatMessage & { token?: string };

export class Chat extends Server<Env> {
  static options = { hibernate: true };

  messages = [] as ServerChatMessage[];

  broadcastMessage(message: Message, exclude?: string[]) {
    this.broadcast(JSON.stringify(message), exclude);
  }

  onStart() {
    // this is where you can initialize things that need to be done before the server starts
    // for example, load previous messages from a database or a service

    // create the messages table if it doesn't exist
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT, token TEXT)`,
    );

    try {
      this.ctx.storage.sql.exec(`ALTER TABLE messages ADD COLUMN token TEXT`);
    } catch (e) {
      // ignore, likely already exists
    }

    // load the messages from the database
    this.messages = this.ctx.storage.sql
      .exec(`SELECT * FROM messages`)
      .toArray() as ServerChatMessage[];
  }

  onConnect(connection: Connection, ctx: import("partyserver").ConnectionContext) {
    const url = new URL(ctx.request.url);
    const token = url.searchParams.get("token");
    if (token) {
      connection.setState({ token });
    }

    // Strip token from messages sent to the client
    const safeMessages = this.messages.map((m) => {
      const { token, ...safeMessage } = m as any;
      return safeMessage as ChatMessage;
    });

    connection.send(
      JSON.stringify({
        type: "all",
        messages: safeMessages,
      } satisfies Message),
    );
  }

  saveMessage(message: ServerChatMessage) {
    // check if the message already exists
    const existingMessage = this.messages.find((m) => m.id === message.id);
    if (existingMessage) {
      this.messages = this.messages.map((m) => {
        if (m.id === message.id) {
          return message;
        }
        return m;
      });
    } else {
      this.messages.push(message);
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO messages (id, user, role, content, token) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET content = ?`,
      message.id,
      message.user,
      message.role,
      JSON.stringify(message.content),
      message.token ?? null,
      JSON.stringify(message.content),
    );
  }

  onMessage(connection: Connection, message: WSMessage) {
    const token = (connection.state as any)?.token;
    const parsed = JSON.parse(message as string) as Message;

    if (parsed.type === "add") {
      // Prevent overwriting existing messages on 'add'
      const existingMessage = this.messages.find((m) => m.id === parsed.id);
      if (existingMessage) {
        return; // Unauthorized or invalid add
      }
      const serverMessage: ServerChatMessage = { ...parsed, token };
      this.saveMessage(serverMessage);

      // broadcast safe message
      const { token: _, type, ...safeMessage } = serverMessage as any;
      this.broadcast(JSON.stringify({ type: "add", ...safeMessage }));
    } else if (parsed.type === "update") {
      const existingMessage = this.messages.find((m) => m.id === parsed.id);
      if (!existingMessage) {
        return; // Message doesn't exist
      }

      // Check authorization token
      if (existingMessage.token !== token) {
        return; // Unauthorized to update
      }

      // Ensure user is not tampered
      if (existingMessage.user !== parsed.user) {
        return;
      }

      const serverMessage: ServerChatMessage = { ...parsed, token };
      this.saveMessage(serverMessage);

      // broadcast safe message
      const { token: _, type, ...safeMessage } = serverMessage as any;
      this.broadcast(JSON.stringify({ type: "update", ...safeMessage }));
    } else {
      // broadcast any other raw messages exactly like original logic
      this.broadcast(message);
    }
  }
}

export default {
  async fetch(request, env) {
    return (
      (await routePartykitRequest(request, { ...env })) ||
      env.ASSETS.fetch(request)
    );
  },
} satisfies ExportedHandler<Env>;
