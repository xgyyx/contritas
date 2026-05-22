import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { pushMock, iterateMock, addSessionMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  iterateMock: vi.fn(),
  addSessionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api-client", () => ({
  api: { iterate: iterateMock },
}));

vi.mock("@/stores/history-store", () => ({
  useHistoryStore: (selector: any) => selector({ addSession: addSessionMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// lucide-react@1.x ships ESM-only icon refs that jsdom can't always parse;
// stub the two we use so the panel can mount.
vi.mock("lucide-react", () => ({
  ArrowDownRight: () => null,
  Plus: () => null,
}));

import { IteratePanel } from "@/components/report/iterate-panel";

describe("<IteratePanel /> (6.7.3)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    iterateMock.mockReset();
    addSessionMock.mockReset();
  });

  it("idle mode shows two entry buttons and no form", () => {
    render(<IteratePanel sessionId="s1" />);
    expect(screen.getByRole("button", { name: /深挖维度/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新增维度/ })).toBeInTheDocument();
    expect(screen.queryByText(/开始迭代/)).not.toBeInTheDocument();
  });

  it("clicking 深挖维度 enters deep_dive mode and shows the form", async () => {
    render(<IteratePanel sessionId="s1" />);
    await userEvent.click(screen.getByRole("button", { name: /深挖维度/ }));

    expect(screen.getByText(/深挖已有维度/)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/目标维度名称或 ID/)
    ).toBeInTheDocument();
    // Submit disabled until target is entered.
    expect(screen.getByRole("button", { name: /开始迭代/ })).toBeDisabled();
  });

  it("submitting deep_dive routes to the new session", async () => {
    iterateMock.mockResolvedValue({ sessionId: "child-1" });
    render(<IteratePanel sessionId="parent-1" />);

    await userEvent.click(screen.getByRole("button", { name: /深挖维度/ }));
    await userEvent.type(
      screen.getByPlaceholderText(/目标维度名称或 ID/),
      "市场规模"
    );
    await userEvent.click(screen.getByRole("button", { name: /开始迭代/ }));

    expect(iterateMock).toHaveBeenCalledWith("parent-1", {
      type: "deep_dive",
      target: "市场规模",
      details: undefined,
    });
    expect(addSessionMock).toHaveBeenCalledWith(
      "child-1",
      expect.stringContaining("深挖")
    );
    expect(pushMock).toHaveBeenCalledWith("/research/child-1");
  });

  it("clicking 取消 returns to idle mode and clears inputs", async () => {
    render(<IteratePanel sessionId="s1" />);
    await userEvent.click(screen.getByRole("button", { name: /新增维度/ }));
    expect(screen.getByText(/新增研究维度/)).toBeInTheDocument();

    await userEvent.type(
      screen.getByPlaceholderText(/新维度名称/),
      "竞品"
    );
    await userEvent.click(screen.getByRole("button", { name: /取消/ }));

    expect(screen.queryByText(/新增研究维度/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新增维度/ })).toBeInTheDocument();
  });
});
