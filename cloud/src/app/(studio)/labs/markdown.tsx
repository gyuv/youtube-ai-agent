import { Fragment, type ReactNode } from "react";

/** A small, dependency-free Markdown renderer for tool results (headings, lists, tables, code, emphasis). */

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) parts.push(<strong key={m.index}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) parts.push(<code key={m.index} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      parts.push(/^https?:\/\//.test(href) ? <a key={m.index} href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">{label}</a> : label);
    } else parts.push(<em key={m.index}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      out.push(<pre key={i} className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">{body.join("\n")}</pre>);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) {
      const size = heading[1].length <= 2 ? "text-lg" : "text-base";
      out.push(<h3 key={i} className={`${size} mt-5 mb-2 font-semibold`}>{inline(heading[2])}</h3>);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      out.push(
        <div key={i} className="my-3 overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b">
                  {r.map((c, ci) => (ri === 0 ? <th key={ci} className="px-2 py-1.5 text-left font-medium">{inline(c)}</th> : <td key={ci} className="px-2 py-1.5 align-top">{inline(c)}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={i} className={`my-2 grid gap-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((it, k) => <li key={k}>{inline(it)}</li>)}
        </List>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      out.push(<blockquote key={i} className="my-2 border-l-2 pl-3 text-muted-foreground">{inline(line.replace(/^>\s?/, ""))}</blockquote>);
      i++;
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) {
      out.push(<hr key={i} className="my-4" />);
      i++;
      continue;
    }
    if (line.trim()) out.push(<p key={i} className="my-2 leading-relaxed">{inline(line)}</p>);
    i++;
  }
  return <div className="text-sm">{out.map((n, k) => <Fragment key={k}>{n}</Fragment>)}</div>;
}
