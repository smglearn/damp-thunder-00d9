import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./index";
import { MemoryRouter, Routes, Route } from "react-router";
import { vi, describe, it, expect, beforeEach } from "vitest";

const mockSend = vi.fn();

vi.mock("partysocket/react", () => ({
  usePartySocket: () => ({
    send: mockSend,
  }),
}));

describe("App component form submission", () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  it("should send a message via socket when the form is submitted", async () => {
    render(
      <MemoryRouter initialEntries={["/room-123"]}>
        <Routes>
          <Route path="/:room" element={<App />} />
        </Routes>
      </MemoryRouter>
    );

    const input = screen.getByRole("textbox");
    const sendButton = screen.getByRole("button", { name: /send/i });

    await userEvent.type(input, "Hello world!");
    await userEvent.click(sendButton);

    expect(mockSend).toHaveBeenCalledTimes(1);

    const sentMessageStr = mockSend.mock.calls[0][0];
    const sentMessage = JSON.parse(sentMessageStr);

    expect(sentMessage.type).toBe("add");
    expect(sentMessage.content).toBe("Hello world!");
    expect(sentMessage.role).toBe("user");
    expect(typeof sentMessage.id).toBe("string");
    expect(typeof sentMessage.user).toBe("string");

    // The input should be cleared after submission
    expect(input).toHaveValue("");

    // The message should be displayed optimistically
    expect(screen.getByText("Hello world!")).toBeInTheDocument();
  });
});
