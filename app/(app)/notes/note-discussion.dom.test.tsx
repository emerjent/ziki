// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ add: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("./actions", () => ({ addNoteCommentAction: mocks.add }));
import { AddNoteButton, NoteDiscussion } from "./note-discussion";

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe("project note comments", () => {
  it("shows Add note immediately and moves keyboard focus to the composer", () => {
    render(<><AddNoteButton /><NoteDiscussion projectId="project" comments={[]} /></>);
    expect(screen.getByText("No comments yet. Add the first note to share what you learned.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Your note" }));
  });

  it("shows a saved human note in the same feed and clears the draft", async () => {
    mocks.add.mockResolvedValue({ comment: { id: "new", body: "Use local Postgres.", authorName: "Person", agentId: null,
      createdAt: "2026-10-31T10:00:00.000Z", upvotes: 0 } });
    render(<NoteDiscussion projectId="project" comments={[{ id: "old", body: "Check migrations.", authorName: "Agent",
      agentId: "agent", createdAt: "2026-10-30T10:00:00.000Z", upvotes: 1 }]} />);
    const draft = screen.getByRole("textbox", { name: "Your note" }) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "Use local Postgres." } });
    fireEvent.click(screen.getByRole("button", { name: "Post note" }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith("project", "Use local Postgres."));
    await waitFor(() => expect(screen.getByText("Use local Postgres.")).toBeTruthy());
    expect(draft.value).toBe("");
    expect(screen.getByText("Check migrations.")).toBeTruthy();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("preserves the draft and announces a failed save", async () => {
    mocks.add.mockResolvedValue({ error: "Could not save your note." });
    render(<NoteDiscussion projectId="project" comments={[]} />);
    const draft = screen.getByRole("textbox", { name: "Your note" }) as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Post note" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not save"));
    expect(draft.value).toBe("Keep this draft");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
