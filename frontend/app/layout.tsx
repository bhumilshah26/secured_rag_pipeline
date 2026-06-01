import "./globals.css";

export const metadata = {
  title: "Secured Enterprise RAG",
  description: "Multi-tenant secure RAG platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
