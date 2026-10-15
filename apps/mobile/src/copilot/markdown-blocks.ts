export type MarkdownBlock =
  | { type: "paragraph" | "heading" | "list"; text: string }
  | { type: "table"; rows: string[][] };
function cells(line: string) {
  let value = line.trim().replace(/^\|/, "");
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);
  const result = [""];
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (char === "\\" && i + 1 < value.length)
      result[result.length - 1] += char + value[++i]!;
    else if (char === "|") result.push("");
    else result[result.length - 1] += char;
  }
  return result.map((cell) => cell.trim());
}
export function markdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.split(/\r?\n/),
    blocks: MarkdownBlock[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (
      line.includes("|") &&
      /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "") &&
      cells(lines[i + 1]!).every((c) => /^:?-{3,}:?$/.test(c))
    ) {
      const rows = [cells(line)];
      i += 2;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim())
        rows.push(cells(lines[i++]!));
      blocks.push({ type: "table", rows });
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      blocks.push({ type: "heading", text: line.replace(/^#{1,4}\s+/, "") });
      i++;
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      blocks.push({ type: "list", text: line.replace(/^\s*[-*]\s+/, "") });
      i++;
      continue;
    }
    const paragraph = [line];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^(?:#{1,4}\s|\s*[-*]\s)/.test(lines[i]!) &&
      !(lines[i]!.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? ""))
    )
      paragraph.push(lines[i++]!);
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}
