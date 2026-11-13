/**
 * Who gets a security-check part (#security-checks). Plain logic with no
 * database, so it is easy to test.
 *
 * Only security-cleared agents that are online and not quiet are candidates.
 * On-call agents go first, then agents already active in the client's
 * workspace, then the agent with the fewest open parts; ties keep list order,
 * so the choice is stable.
 */

export type CandidateAgent = {
  id: string;
  /** On call: gets priority work. */
  onCall: boolean;
  /** Workspaces the agent is active in. */
  organisationIds: string[];
  /** Parts it holds now. */
  openJobs: number;
};

export function pickAgentFor(organisationId: string, agents: CandidateAgent[], maxOpenJobs: number): CandidateAgent | null {
  let best: CandidateAgent | null = null;
  let bestRank: [number, number, number] | null = null;
  for (const agent of agents) {
    if (agent.openJobs >= maxOpenJobs) continue;
    const rank: [number, number, number] = [agent.onCall ? 0 : 1, agent.organisationIds.includes(organisationId) ? 0 : 1, agent.openJobs];
    if (!bestRank || compare(rank, bestRank) < 0) {
      best = agent;
      bestRank = rank;
    }
  }
  return best;
}

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
