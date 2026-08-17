import Link from "next/link";

export const metadata = { title: "Privacy Policy · AegisRAG" };

const EFFECTIVE_DATE = "August 15, 2026";
const CONTACT_EMAIL = "aegisrag.support5@gmail.com"; // ← replace

export default function PrivacyPage() {
  return (
    <main className="page container reading" style={{ padding: "48px 20px" }}>
      <div className="page-head">
        <h1>Privacy Policy</h1>
        <p className="lead">Effective {EFFECTIVE_DATE}</p>
      </div>

      <section className="stack" style={{ gap: 18, fontSize: 14.5, lineHeight: 1.65 }}>
        <p>
          Aegis (&quot;the Service&quot;) is a secure, multi-tenant knowledge platform. Organizations
          connect their own data sources — such as Google Drive, Confluence, OneDrive, SharePoint,
          and Slack — or upload documents directly, and query that content through a chat interface.
          This policy explains what we collect, why, and the choices you have.
        </p>

        <h2>Information we collect</h2>
        <p>
          <strong>Account information.</strong> When you register or are invited to a workspace, we
          store your email address, a securely hashed password (never the password itself), your
          role, and your organization (tenant).
        </p>
        <p>
          <strong>Content you choose to index.</strong> When you upload a file or select items from
          a connected source, we extract their text and store it — along with the document title and
          the roles allowed to read it — as searchable vectors, isolated to your organization. We
          index only the items you explicitly select; we do not crawl your accounts.
        </p>
        <p>
          <strong>Connection metadata.</strong> For connected sources we store non-secret metadata
          such as the source type, a display name, and connection status. OAuth authorization is
          brokered by our authentication partner, Composio; <strong>your source credentials and
          access tokens are never stored on our servers.</strong> For Google Drive connections we
          store the connected account&apos;s email address solely to show you which account is linked.
        </p>
        <p>
          <strong>Audit records.</strong> For security, we keep structured logs of sensitive actions
          (sign-ins, queries, permission changes). These contain hashed queries and document IDs —
          never your raw questions, document text, or passwords — and personal identifiers such as
          emails or phone numbers are masked before anything is written.
        </p>

        <h2>How we use information</h2>
        <p>
          We use the data above to operate the Service: authenticating you, retrieving passages from
          your organization&apos;s indexed content to answer your questions with citations, enforcing
          role-based access, sending operational emails (verification codes, account invitations),
          and detecting abuse. We do not sell your data, use it for advertising, or use your
          documents to train machine-learning models.
        </p>

        <h2>Google user data — Limited Use disclosure</h2>
        <p>
          Aegis&apos;s use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>, including the Limited Use requirements. Google Drive content is accessed only for the
          files you select, used only to provide the indexing and question-answering features you
          request, and is never transferred to third parties except as necessary to provide those
          features, comply with law, or as part of a merger or acquisition with prior notice.
        </p>

        <h2>Atlassian and other connected services</h2>
        <p>
          For Confluence, we access the pages you select from the site you authorize and store only
          their extracted text and titles. We do not store Atlassian account identifiers or profile
          information. Each connected service is governed by its own terms and privacy policy in
          addition to this one.
        </p>

        <h2>Sharing and processors</h2>
        <p>
          We share data only with the infrastructure providers needed to run the Service — hosting,
          database and vector storage, OAuth brokering (Composio), email delivery, and the AI model
          provider that generates answers from retrieved passages — each acting on our instructions.
          We may disclose information if required by law.
        </p>

        <h2>Retention and deletion</h2>
        <p>
          Indexed content remains until you delete it: removing a document or a connected source
          permanently deletes its stored text, vectors, and permissions from our systems. Deleting a
          user removes their account records. If you want your organization&apos;s data removed
          entirely, contact us and we will delete the tenant and everything within it.
        </p>

        <h2>Security</h2>
        <p>
          The Service is designed security-first: tenant isolation enforced on every query,
          role-based access to documents, prompt-injection screening, encrypted transport, hashed
          passwords, and PII-masked audit logs. No system is perfectly secure, but access to your
          content is restricted to your organization under the permissions you set.
        </p>

        <h2>Changes and contact</h2>
        <p>
          We may update this policy and will change the effective date above when we do. Questions
          or requests (including data deletion) can be sent to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <p style={{ marginTop: 8 }}>
          <Link href="/">← Back to Aegis</Link>
        </p>
      </section>
    </main>
  );
}