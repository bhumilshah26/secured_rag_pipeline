"use client";
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="auth-wrap">
      <div className="panel auth-card stack" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h1 style={{ fontSize: 22 }}>Something went wrong</h1>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>{error?.message || "An unexpected error occurred."}</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn btn-primary" onClick={reset}>Try again</button>
        </div>
      </div>
    </main>
  );
}
