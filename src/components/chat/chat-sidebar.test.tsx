// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatSidebar } from "./chat-sidebar";
import type { SessionInfo } from "@/components/sessions/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-session-meta", () => ({
  useSessionMeta: () => ({
    metaMap: {},
    loading: false,
    getMeta: () => ({
      displayName: "This is an intentionally long session name that should truncate cleanly",
      pinned: false,
      tags: [],
      deleted: false,
    }),
    updateMeta: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/sessions/session-actions", () => ({
  SessionActions: ({ trigger }: { trigger?: React.ReactNode }) => trigger ?? <button type="button" title="Session actions">...</button>,
  getTagColor: () => "",
}));

describe("ChatSidebar session item layout", () => {
  const session: SessionInfo = {
    id: "session-1",
    project: "project-1",
    projectName: "Super-Claude-Code",
    startTime: Date.now() - 60_000,
    lastActive: Date.now() - 30_000,
    messageCount: 3,
    firstMessage: "short fallback",
    model: "gpt-5.4",
    provider: "codex",
    totalInputTokens: 100,
    totalOutputTokens: 200,
    cacheReadTokens: 0,
    estimatedCost: 0.12,
    status: "idle",
  };

  test("renders a two-line session row with a reserved more-actions slot", () => {
    const { container } = render(
      <ChatSidebar
        sessions={[session]}
        selectedKey=""
        onSelect={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    const title = screen.getByText("This is an intentionally long session name that should truncate cleanly");
    expect(title.className).toContain("truncate");
    expect(title.className).toContain("min-w-0");
    expect(title.className).toContain("flex-1");
    expect(title.className).toContain("overflow-hidden");

    const moreButton = screen.getByTitle("Session actions");
    const actionCluster = moreButton.parentElement;
    expect(actionCluster).not.toBeNull();
    expect(actionCluster?.className).toContain("w-6");
    expect(actionCluster?.className).toContain("shrink-0");
    expect(moreButton.className).toContain("opacity-0");
    expect(moreButton.className).toContain("pointer-events-none");
    expect(moreButton.className).toContain("group-hover:opacity-100");
    expect(moreButton.className).toContain("group-focus-within:opacity-100");

    const selectionButton = title.closest("button");
    expect(selectionButton).not.toBeNull();
    expect(selectionButton?.contains(moreButton)).toBe(false);
    expect(selectionButton?.className).toContain("flex-1");
    expect(selectionButton?.className).toContain("text-left");

    const sessionRow = selectionButton?.parentElement;
    expect(sessionRow?.className).toContain("flex");
    expect(sessionRow?.className).toContain("items-start");

    const pathLine = container.querySelector(".mt-0\\.5");
    expect(pathLine).not.toBeNull();
    expect((pathLine as HTMLElement).className).toContain("flex");
    expect((pathLine as HTMLElement).className).toContain("items-center");

    expect(container.querySelector(".group")).not.toBeNull();
  });

  test("supports dragging sidebar width and resets to default on remount", () => {
    const firstRender = render(
      <ChatSidebar
        sessions={[session]}
        selectedKey=""
        onSelect={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    const sidebar = screen.getByTestId("chat-sidebar");
    const handle = screen.getByTestId("chat-sidebar-resize-handle");

    expect((sidebar as HTMLElement).style.width).toBe("288px");

    fireEvent.mouseDown(handle, { clientX: 288 });
    fireEvent.mouseMove(window, { clientX: 360 });
    fireEvent.mouseUp(window);

    expect((sidebar as HTMLElement).style.width).toBe("360px");

    firstRender.unmount();

    render(
      <ChatSidebar
        sessions={[session]}
        selectedKey=""
        onSelect={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    expect((screen.getByTestId("chat-sidebar") as HTMLElement).style.width).toBe("288px");
  });
});
