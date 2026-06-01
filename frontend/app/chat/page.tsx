"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Topbar from "@/app/components/Topbar";
import { chat, getToken, ingestText, uploadFile, type ChatResponse } from "@/lib/api";

const ALL_ROLES = ["ADMIN", "HR", "ANALYST", "MANAGER", "VIEWER"];

export default function ChatPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [resp, setResp] = useState<ChatResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadRoles, setUploadRoles] = useState<string[]>(["ADMIN", "VIEWER"]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  function toggleRole(role: string) {
    setUploadRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    setUploadMsg(`Uploading ${file.name}…`);
    try {
      const doc = await uploadFile(file, uploadRoles.length ? uploadRoles : ["VIEWER"]);
      setUploadMsg(
        `Indexed "${doc.title}" — ${doc.chunk_count} chunks · roles: ${doc.allowed_roles.join(", ")}`
      );
    } catch (err) {
      setUploadMsg("");
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function seedDoc() {
    setError("");
    try {
      await ingestText(
        "Company Leave Policy",
        "Employees are entitled to 20 days of paid annual leave per year. " +
          "Requests must be approved by a manager at least 5 business days in advance.",
        ["VIEWER", "MANAGER", "HR", "ADMIN"]
      );
      setUploadMsg("Sample document indexed. Try asking about the leave policy.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      setResp(await chat(query));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const riskBadge = (risk: string) => {
    const cls = risk === "ALLOW" ? "badge-ok" : risk === "FLAG" ? "badge-warn" : "badge-info";
    return <span className={`badge ${cls}`}><span className="dot" />risk: {risk}</span>;
  };

  return (
    <>
      <Topbar />
      <main className="container">
        <h1 className="title-gradient" style={{ marginBottom: 4 }}>Knowledge Chat</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Ask questions across your authorized documents — answers are grounded and cited.
        </p>

        {/* Upload card */}
        <div className="card">
          <div className="section-title">Add a document</div>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            PDF, DOCX, XLSX, images, TXT/MD — scanned files are OCR&apos;d. Choose which roles may
            retrieve it:
          </p>
          <div className="row" style={{ marginBottom: 12 }}>
            {ALL_ROLES.map((role) => (
              <span
                key={role}
                className={`chip ${uploadRoles.includes(role) ? "active" : ""}`}
                onClick={() => toggleRole(role)}
              >
                {role}
              </span>
            ))}
          </div>
          <div className="row">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.tiff"
              onChange={handleUpload}
              className="input grow"
            />
            <button className="btn btn-ghost" onClick={seedDoc} type="button">
              Seed sample
            </button>
          </div>
          {uploading && <div className="toast toast-ok"><span className="spinner" /> working…</div>}
          {!uploading && uploadMsg && <div className="toast toast-ok">{uploadMsg}</div>}
        </div>

        {/* Ask card */}
        <div className="card">
          <div className="section-title">Ask</div>
          <form onSubmit={ask} className="row">
            <input
              className="input grow"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. How many annual leave days do employees get?"
            />
            <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
              {loading ? <span className="spinner" /> : "Ask"}
            </button>
          </form>
          {error && <div className="toast toast-err">{error}</div>}
        </div>

        {/* Answer */}
        {resp && (
          <div className="card">
            <div className="meta-row">
              {riskBadge(resp.security_risk)}
              <span className="badge"><span className="dot" />model: {resp.model_used}</span>
              <span className="badge"><span className="dot" />{resp.citations.length} sources</span>
            </div>
            <p className="answer">{resp.answer}</p>

            {resp.citations.length > 0 && (
              <>
                <div className="divider" />
                <div className="section-title">Sources</div>
                {resp.citations.map((c, i) => (
                  <div key={i} className="cite">
                    <div>
                      <strong>{c.title}</strong>
                      {c.section && <span className="crumb"> › {c.section}</span>}{" "}
                      <span className="muted">({c.score})</span>
                    </div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                      {c.snippet}…
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </main>
    </>
  );
}
