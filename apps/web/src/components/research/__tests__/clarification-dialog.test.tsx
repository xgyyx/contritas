import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { respondMock, clearClarificationMock, setStatusMock } = vi.hoisted(
  () => ({
    respondMock: vi.fn(),
    clearClarificationMock: vi.fn(),
    setStatusMock: vi.fn(),
  })
);

vi.mock("@/lib/api-client", () => ({
  api: { respond: respondMock },
}));

vi.mock("@/stores/research-store", () => ({
  useResearchStore: (selector: any) =>
    selector({
      clearClarification: clearClarificationMock,
      setStatus: setStatusMock,
    }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { ClarificationDialog } from "@/components/research/clarification-dialog";

describe("<ClarificationDialog /> (6.7.3)", () => {
  beforeEach(() => {
    respondMock.mockReset();
    clearClarificationMock.mockReset();
    setStatusMock.mockReset();
  });

  it("does not render dialog content when there are no questions", () => {
    render(
      <ClarificationDialog
        sessionId="s1"
        questions={[]}
        suggestedDirections={[]}
      />
    );
    // Title only renders inside the open dialog.
    expect(screen.queryByText(/需要补充信息/)).not.toBeInTheDocument();
  });

  it("renders questions and disables submit until response is non-empty", async () => {
    render(
      <ClarificationDialog
        sessionId="s1"
        questions={["What sector?", "What time horizon?"]}
        suggestedDirections={[]}
      />
    );

    expect(screen.getByText("What sector?")).toBeInTheDocument();
    expect(screen.getByText("What time horizon?")).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: /提交回复/ });
    expect(submit).toBeDisabled();

    await userEvent.type(
      screen.getByPlaceholderText(/输入你的回复/),
      "specifically SaaS, 2026"
    );
    expect(submit).not.toBeDisabled();
  });

  it("submits trimmed response, clears clarification, and flips status to in_progress", async () => {
    respondMock.mockResolvedValue({ success: true });
    render(
      <ClarificationDialog
        sessionId="sess-x"
        questions={["q1?"]}
        suggestedDirections={[]}
      />
    );

    await userEvent.type(
      screen.getByPlaceholderText(/输入你的回复/),
      "  hello world  "
    );
    await userEvent.click(screen.getByRole("button", { name: /提交回复/ }));

    expect(respondMock).toHaveBeenCalledWith("sess-x", { response: "hello world" });
    expect(clearClarificationMock).toHaveBeenCalledTimes(1);
    expect(setStatusMock).toHaveBeenCalledWith("in_progress");
  });

  it("clicking a suggested-direction badge populates the textarea", async () => {
    render(
      <ClarificationDialog
        sessionId="s1"
        questions={["q?"]}
        suggestedDirections={["Focus on Series A 2026"]}
      />
    );

    const badge = screen.getByText("Focus on Series A 2026");
    await userEvent.click(badge);

    const textarea = screen.getByPlaceholderText(/输入你的回复/) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Focus on Series A 2026");
  });
});
