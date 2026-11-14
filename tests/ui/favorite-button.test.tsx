// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FavoriteButton } from "@/components/favorite-button";

const setFavoriteAction = vi.fn();
const refresh = vi.fn();
const toast = vi.fn();

vi.mock("@/app/actions/favorites", () => ({
  setFavoriteAction: (...args: unknown[]) => setFavoriteAction(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FavoriteButton", () => {
  it("starts on for a starred issue and turns off when clicked", async () => {
    setFavoriteAction.mockResolvedValue({ ok: true, favorited: false });
    render(<FavoriteButton bugId="b1" favorited />);

    const star = screen.getByRole("button", { name: "Starred, remove from your starred issues" });
    expect(star).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(star);

    await waitFor(() => expect(setFavoriteAction).toHaveBeenCalledWith("b1", false));
    expect(star).toHaveAttribute("aria-pressed", "false");
    expect(refresh).toHaveBeenCalled();
  });

  it("fills straight away, then puts the star back if saving fails", async () => {
    let fail: (value: { error: string }) => void = () => {};
    setFavoriteAction.mockReturnValue(new Promise((resolve) => { fail = resolve; }));
    render(<FavoriteButton bugId="b1" favorited={false} />);

    const star = screen.getByRole("button", { name: "Star this issue" });
    fireEvent.click(star);
    expect(star).toHaveAttribute("aria-pressed", "true");

    fail({ error: "Issue not found" });

    await waitFor(() => expect(star).toHaveAttribute("aria-pressed", "false"));
    expect(toast).toHaveBeenCalledWith("Issue not found", "error");
  });

  it("can't change a deleted issue's star", () => {
    render(<FavoriteButton bugId="b1" favorited={false} readOnly />);
    expect(screen.getByRole("button", { name: "Star this issue" })).toBeDisabled();
  });
});
