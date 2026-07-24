import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const port = Number(process.env.PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
    let filePath = join(root, safePath);
    if (!filePath.startsWith(root)) throw new Error("Invalid path");
    if ((await stat(filePath).catch(() => null))?.isDirectory()) filePath = join(filePath, "index.html");
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mime[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(content);
  } catch {
    try {
      const fallback = await readFile(join(root, "index.html"));
      response.writeHead(404, { "Content-Type": mime[".html"] });
      response.end(fallback);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Chronovex is live at http://127.0.0.1:${port}`);
});
