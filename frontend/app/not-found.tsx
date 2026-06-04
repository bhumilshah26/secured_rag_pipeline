import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-wrap">
      <div className="panel auth-card stack" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>🧭</div>
        <h1 style={{ fontSize: 22 }}>Page not found</h1>
        <p className="muted" style={{ margin: 0 }}>That route doesn&apos;t exist or you don&apos;t have access to it.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn btn-primary" href="/overview">Back to overview</Link>
        </div>
      </div>
    </main>
  );
}
