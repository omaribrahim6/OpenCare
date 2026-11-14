import Link from "next/link";

/** Shown when the kiosk has no patient session (expired, ended, or this page was opened directly). */
export function NoSession({ message }: { message?: string }) {
  return (
    <div className="card" role="alert">
      <h2 style={{ marginTop: 0 }}>Please tap your CareCard again</h2>
      <p>{message ?? "Your session has ended, so we can't show your information."}</p>
      <Link className="btn secondary" href="/kiosk">
        Back to start
      </Link>
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card" role="alert">
      <p style={{ marginTop: 0 }}>{message}</p>
      <button className="btn secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
