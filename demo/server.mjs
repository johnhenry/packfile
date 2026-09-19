import { readFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fromArchive } from "../lib/from-archive.mjs";
import { createRouter } from "../lib/create-router.mjs";
import { getContentType } from "../lib/mime.mjs";
import theresWaldo from "theres-waldo";
const { dir } = theresWaldo(import.meta.url);

const port = 3000;

const compiledData = readFileSync(join(dir, "./compiled.cbor"));
const files = await fromArchive(compiledData, { compressed: true });
const router = createRouter(files, { alias: { "/": "index.html" } });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname.startsWith("/compiled/")) {
    const path = url.pathname.slice("/compiled/".length);
    try {
      const response = await router("/" + path);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("File not found");
    }
    return;
  }

  // Static-serve the demo directory itself (index.html, etc.)
  try {
    const staticPath = join(dir, url.pathname === "/" ? "index.html" : url.pathname);
    const content = await readFileAsync(staticPath);
    const contentType = getContentType(staticPath.slice(1));
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
