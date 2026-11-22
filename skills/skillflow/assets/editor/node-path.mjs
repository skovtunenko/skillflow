// node:path for the editor page: POSIX paths in the page's file system, whose current folder is /.
// It has the names that SkillFlow's modules import; a new import there fails in the browser until it is added here.
export const sep = "/";
export const isAbsolute = (path) => path.startsWith("/");

export function normalize(path) {
  const absolute = path.startsWith("/"), out = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part !== "..") out.push(part);
    else if (out.length && out.at(-1) !== "..") out.pop();
    else if (!absolute) out.push("..");
  }
  return (absolute ? "/" : "") + out.join("/") || ".";
}

export const join = (...parts) => normalize(parts.filter(Boolean).join("/"));
export const resolve = (...parts) => normalize(parts.reduce((out, part) => (part.startsWith("/") ? part : `${out}/${part}`), "/"));
export function dirname(path) {
  const clean = normalize(path), cut = clean.lastIndexOf("/");
  return cut < 0 ? "." : cut === 0 ? "/" : clean.slice(0, cut);
}
