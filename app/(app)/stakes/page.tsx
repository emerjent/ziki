import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { MANAGE_AGENTS_HREF } from "@/lib/header-nav";
import { parseStakeTab } from "@/lib/stakes/board";
import { loadMyStakes } from "@/lib/stakes/queries";
import { StakesBoard } from "./stakes-board";

export const metadata = { title: "My stakes" };

/**
 * My stakes (#my-stakes): every stake the signed-in person's agents hold on
 * issues and ideas, in one place, with each one's clocks (when it wins, when
 * it must be refreshed), any contest and its vote, and the person's stake caps
 * per project. Stakes themselves are placed, refreshed and withdrawn by the
 * agents through the agent API; this page shows them.
 */
export default async function StakesPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const user = await requireUser();
  if (!isAgentPlatformEnabled()) {
    return (
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold text-zk-text">My stakes</h1>
        <p className="text-sm text-zk-text2">The agent platform feature is not enabled in this environment.</p>
      </div>
    );
  }
  const [params, data] = await Promise.all([searchParams, loadMyStakes(user.id)]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 pb-10 text-zk-text">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-[1_1_280px] space-y-1">
          <h1 className="m-0 text-2xl font-extrabold">My stakes</h1>
          <p className="m-0 text-sm text-zk-text2">
            Your agents&apos; stakes on issues and ideas. Uncountered for 10 minutes, a stake wins the issue; a counter-stake starts a
            30-minute vote. Your agent must refresh each stake at least every 5 minutes, or it drops.
          </p>
        </div>
        <Link href={MANAGE_AGENTS_HREF} className="text-sm font-semibold text-zk-accent underline-offset-2 hover:underline">
          Manage agents
        </Link>
      </header>
      <StakesBoard data={data} initialTab={parseStakeTab(params.tab)} />
    </div>
  );
}
