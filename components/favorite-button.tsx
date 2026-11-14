"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFavoriteAction } from "@/app/actions/favorites";
import { useToast } from "@/components/ui/toast";

/**
 * The star on an issue page (#902): a private bookmark, separate from
 * watching. The star fills on click and goes back if the save fails.
 */
export function FavoriteButton({
  bugId,
  favorited,
  readOnly = false,
}: {
  bugId: string;
  favorited: boolean;
  /** Deleted issues: the star stays as it is, but can't be changed. */
  readOnly?: boolean;
}) {
  const [starred, setStarred] = useState(favorited);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const toggle = () => {
    const next = !starred;
    setStarred(next);
    startTransition(async () => {
      const result = await setFavoriteAction(bugId, next);
      if (result.error) {
        setStarred(!next);
        toast(result.error, "error");
        return;
      }
      setStarred(result.favorited ?? next);
      toast(
        next
          ? "Starred. Find it under Starred on the issues list."
          : "Removed from your starred issues.",
      );
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      disabled={pending || readOnly}
      aria-pressed={starred}
      aria-label={starred ? "Starred, remove from your starred issues" : "Star this issue"}
      title={starred ? "Remove from starred" : "Star this issue"}
      onClick={toggle}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors active:scale-95 disabled:opacity-50 ${
        starred
          ? "border-amber-400 bg-amber-50 text-amber-600 hover:bg-amber-100"
          : "border-zk-border bg-zk-surface text-zk-muted hover:bg-zk-chip hover:text-zk-text"
      }`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={starred ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={starred ? 0 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2.5l2.98 6.04 6.67.97-4.82 4.7 1.14 6.64L12 17.72 6.03 20.85l1.14-6.64-4.82-4.7 6.67-.97z" />
      </svg>
    </button>
  );
}
