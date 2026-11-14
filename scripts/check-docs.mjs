#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve, relative, extname } from "node:path";
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const documents = tracked.filter((p) => /\.md$/i.test(p));
const selected = process.argv.slice(2);
const clean = (text) =>
  text.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "");
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
    .replace(/\s/g, "-");
const cache = new Map();
function anchors(file) {
  if (cache.has(file)) return cache.get(file);
  const text = clean(readFileSync(file, "utf8"));
  const result = new Set();
  const seen = new Map();
  const headings = [
    ...text.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm),
    ...text.matchAll(/^([^\n]+)\n {0,3}(?:=+|-+)\s*$/gm),
  ].sort((a, b) => a.index - b.index);
  for (const heading of headings) {
    const id = slug(heading[1]);
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    result.add(count ? `${id}-${count}` : id);
  }
  for (const m of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g))
    result.add(m[1]);
  cache.set(file, result);
  return result;
}
const failures = [];
function check(file, raw) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) return;
  try {
    const url = decodeURIComponent(raw);
    const [name, fragment] = url.split("#");
    const target = name.startsWith("/")
      ? resolve(root, "." + name.split("?")[0])
      : resolve(root, dirname(file), name.split("?")[0] || ".");
    const actual = !name ? resolve(root, file) : target;
    if (relative(root, actual).startsWith("../"))
      throw Error("outside repository");
    const stat = statSync(actual);
    if (fragment && stat.isFile()) {
      const line = fragment.match(/^L(\d+)(?:-L(\d+))?$/);
      if (line && !/\.md$/i.test(extname(actual))) {
        const count = readFileSync(actual, "utf8")
          .replace(/\n$/, "")
          .split("\n").length;
        if (
          Number(line[1]) < 1 ||
          Number(line[2] ?? line[1]) > count ||
          Number(line[2] ?? line[1]) < Number(line[1])
        )
          throw Error("missing line anchor");
      } else if (!anchors(actual).has(fragment)) throw Error("missing anchor");
    }
  } catch (error) {
    failures.push(
      `${file}: ${raw} (${error.code === "ENOENT" ? "missing file" : error.message})`,
    );
  }
}
for (const file of documents.filter(
  (p) => !selected.length || selected.includes(p),
)) {
  const text = clean(readFileSync(resolve(root, file), "utf8")).replace(
    /`+[^`\n]*`+/g,
    "",
  );
  const definitions = new Map();
  for (const m of text.matchAll(/^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm)) {
    definitions.set(m[1].toLowerCase(), m[2]);
    check(file, m[2]);
  }
  for (const m of text.matchAll(
    /!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]*(?:\([^)]*\)[^\s)]*)*)\s*(?:["'][^\n]*?["'])?\s*\)/g,
  ))
    check(file, m[1].replace(/^<|>$/g, ""));
  for (const m of text.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const ref = (m[2] || m[1]).toLowerCase();
    if (definitions.has(ref)) check(file, definitions.get(ref));
  }
  for (const m of text.matchAll(/(?:href|src)=["']([^"']+)["']/g))
    check(file, m[1]);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Markdown relative links passed (${selected.length ? "selected" : documents.length} tracked documents).`,
  );
