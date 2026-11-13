const card = "rounded-[20px] border border-zk-border bg-zk-surface p-5 sm:p-6";
const bone = "rounded bg-zk-border motion-safe:animate-pulse";

export default function LoadingSecuritySettings() {
  return (
    <div className="security-page mx-auto flex w-full max-w-5xl flex-col gap-5 pb-10" aria-busy="true">
      <p role="status" className="sr-only">
        Loading security settings…
      </p>
      <div className={`${bone} h-3 w-56`} aria-hidden="true" />
      <div className="space-y-3" aria-hidden="true">
        <div className={`${bone} h-8 w-64`} />
        <div className={`${bone} h-4 w-full max-w-2xl`} />
      </div>
      {[1, 2, 2, 1, 3].map((rows, section) => (
        <div key={section} className={`${card} space-y-3`} aria-hidden="true">
          <div className={`${bone} h-5 w-48`} />
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className={`${bone} h-6 w-full`} />
          ))}
        </div>
      ))}
    </div>
  );
}
