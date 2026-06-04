// Minimal, dependency-free Markdown renderer for streamed answers.
// Handles bold, italic, inline code, links, headings, and ordered/unordered lists.
// Tolerant of partial markup mid-stream (an unclosed ** renders literally until it closes).
import type { ReactNode } from "react";

const INLINE =
  /(\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_|`([^`]+?)`|\[([^\]]+?)\]\(([^)\s]+?)\))/g;

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] != null || m[3] != null) nodes.push(<strong key={key++}>{m[2] ?? m[3]}</strong>);
    else if (m[4] != null || m[5] != null) nodes.push(<em key={key++}>{m[4] ?? m[5]}</em>);
    else if (m[6] != null) nodes.push(<code key={key++}>{m[6]}</code>);
    else if (m[7] != null) nodes.push(<a key={key++} href={m[8]} target="_blank" rel="noreferrer">{m[7]}</a>);
    last = INLINE.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function paragraph(text: string): ReactNode[] {
  return text.split("\n").flatMap((ln, i) =>
    i === 0 ? inline(ln) : [<br key={`br${i}`} />, ...inline(ln)]
  );
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      const Tag = (h[1].length <= 2 ? "h3" : "h4") as "h3" | "h4";
      blocks.push(<Tag key={key++}>{inline(h[2])}</Tag>);
      i++; continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*[-*+]\s+/, ""))}</li>);
        i++;
      }
      blocks.push(<ul key={key++}>{items}</ul>);
      continue;
    }

    const ord = line.match(/^\s*(\d+)\.\s+/);
    if (ord) {
      // Preserve the source number so a list split by sub-bullets keeps counting (1, 2, 3…).
      const start = parseInt(ord[1], 10) || 1;
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>);
        i++;
      }
      blocks.push(<ol key={key++} start={start}>{items}</ol>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s)/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    blocks.push(<p key={key++}>{paragraph(para.join("\n"))}</p>);
  }

  return <div className="md">{blocks}</div>;
}
