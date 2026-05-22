import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { pushMock, createResearchMock, addSessionMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  createResearchMock: vi.fn(),
  addSessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api-client", async () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    api: { createResearch: createResearchMock },
    ApiError,
  };
});

vi.mock("@/stores/history-store", () => ({
  useHistoryStore: (selector: any) => selector({ addSession: addSessionMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { InputForm } from "@/components/research/input-form";
import { ApiError } from "@/lib/api-client";

describe("<InputForm /> (6.7.3)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    createResearchMock.mockReset();
    addSessionMock.mockReset();
  });

  it("disables submit when proposition is below 10 chars and shows the count", async () => {
    render(<InputForm />);
    const submit = screen.getByRole("button", { name: /开始研究/ });
    expect(submit).toBeDisabled();

    const textarea = screen.getByPlaceholderText(/例如/);
    await userEvent.type(textarea, "短"); // 1 char
    expect(submit).toBeDisabled();
    expect(screen.getByText(/至少 10 字符/)).toBeInTheDocument();
  });

  it("submits and routes to /research/:id on success", async () => {
    createResearchMock.mockResolvedValue({ sessionId: "s-123" });
    render(<InputForm />);

    const textarea = screen.getByPlaceholderText(/例如/);
    await userEvent.type(textarea, "投资 A 轮是否值得推进？需要研究市场");
    const submit = screen.getByRole("button", { name: /开始研究/ });
    expect(submit).not.toBeDisabled();

    await userEvent.click(submit);

    expect(createResearchMock).toHaveBeenCalledTimes(1);
    expect(createResearchMock.mock.calls[0][0]).toMatchObject({
      language: "zh",
    });
    expect(addSessionMock).toHaveBeenCalledWith("s-123", expect.any(String));
    expect(pushMock).toHaveBeenCalledWith("/research/s-123");
  });

  it("shows rate-limit message on HTTP 429 and does not route", async () => {
    createResearchMock.mockRejectedValue(new ApiError(429, "Too Many Requests"));
    render(<InputForm />);

    await userEvent.type(
      screen.getByPlaceholderText(/例如/),
      "投资 A 轮是否值得推进？需要研究市场"
    );
    await userEvent.click(screen.getByRole("button", { name: /开始研究/ }));

    expect(await screen.findByText(/请求过于频繁/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("toggles language between zh and en", async () => {
    render(<InputForm />);
    const enBadge = screen.getByText("English");
    await userEvent.click(enBadge);

    createResearchMock.mockResolvedValue({ sessionId: "s-en" });
    await userEvent.type(
      screen.getByPlaceholderText(/例如/),
      "Should we adopt Rust for backend services this year?"
    );
    await userEvent.click(screen.getByRole("button", { name: /开始研究/ }));

    expect(createResearchMock.mock.calls[0][0].language).toBe("en");
  });
});
