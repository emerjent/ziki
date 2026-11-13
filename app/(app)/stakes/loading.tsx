/** My stakes while it loads (#my-stakes): the page's outline, so nothing jumps when the stakes arrive. */
export default function StakesLoading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 pb-10" aria-busy="true">
      <p role="status" className="sr-only">Loading your stakes…</p>
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-zk-chip" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-zk-chip" />
      </div>
      <div className="flex flex-wrap gap-3">
        {[0, 1].map((key) => (
          <div key={key} className="h-16 w-56 animate-pulse rounded-2xl border border-zk-border bg-zk-surface" />
        ))}
      </div>
      <div className="h-10 w-80 max-w-full animate-pulse rounded-full bg-zk-chip" />
      {[0, 1, 2].map((key) => (
        <div key={key} className="h-36 animate-pulse rounded-2xl border border-zk-border bg-zk-surface" />
      ))}
    </div>
  );
}
