import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./index";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mocking react-router
vi.mock("react-router", () => ({
  useParams: () => ({ room: "test-room" }),
  BrowserRouter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Routes: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Route: () => null,
  Navigate: () => null,
}));

// Mocking partysocket/react
const { mockSend, sharedState } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  sharedState: { mockOnMessage: null as any },
}));

vi.mock("partysocket/react", () => ({
  usePartySocket: (options: any) => {
    sharedState.mockOnMessage = options.onMessage;
    return {
      send: mockSend,
    };
  },
}));

// Mock nanoid for predictable IDs
vi.mock("nanoid", () => ({
  nanoid: () => "test-id",
}));

describe("App Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("renders correctly and displays initial elements", () => {
    render(<App />);
    expect(screen.getByRole("textbox", { name: "" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("handles submitting a new message", async () => {
    render(<App />);
    const input = screen.getByRole("textbox");
    const submitButton = screen.getByRole("button", { name: "Send" });
    const user = userEvent.setup();

    await user.type(input, "Hello world!");
    await user.click(submitButton);

    // Message should be added to the UI
    expect(screen.getByText("Hello world!")).toBeInTheDocument();

    // Socket send should be called
    expect(mockSend).toHaveBeenCalledWith(
      expect.stringContaining('"content":"Hello world!"')
    );

    // Input should be cleared
    expect(input).toHaveValue("");
  });

  it("handles receiving a new message (add type)", async () => {
    render(<App />);

    // Simulate receiving a message from socket
    act(() => {
      sharedState.mockOnMessage({
        data: JSON.stringify({
          type: "add",
          id: "msg-1",
          content: "Incoming message!",
          user: "Alice",
          role: "user",
        })
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Incoming message!")).toBeInTheDocument();
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });
  });

  it("handles receiving an update message", async () => {
    render(<App />);

    // Add initial message
    act(() => {
      sharedState.mockOnMessage({
        data: JSON.stringify({
          type: "add",
          id: "msg-1",
          content: "Initial content",
          user: "Alice",
          role: "user",
        })
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Initial content")).toBeInTheDocument();
    });

    // Update message
    act(() => {
      sharedState.mockOnMessage({
        data: JSON.stringify({
          type: "update",
          id: "msg-1",
          content: "Updated content",
          user: "Alice",
          role: "user",
        })
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Updated content")).toBeInTheDocument();
      expect(screen.queryByText("Initial content")).not.toBeInTheDocument();
    });
  });

  it("handles setting initial messages (sync type)", async () => {
    render(<App />);

    act(() => {
      sharedState.mockOnMessage({
        data: JSON.stringify({
          type: "sync", // assuming any type not 'add' or 'update' is a full sync
          messages: [
            { id: "msg-1", content: "Sync msg 1", user: "Alice", role: "user" },
            { id: "msg-2", content: "Sync msg 2", user: "Bob", role: "user" }
          ]
        })
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Sync msg 1")).toBeInTheDocument();
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Sync msg 2")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });
  });
});
