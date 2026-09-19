#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { constants } from "node:zlib";
import { fromDirectory } from "./lib/from-directory.mjs";
import { toArchive } from "./lib/to-archive.mjs";
import { fromArchive } from "./lib/from-archive.mjs";
import { createRouter } from "./lib/create-router.mjs";
import { decompileDirectory } from "./compat.mjs";

function log(level, message) {
  const timestamp = new Date().toISOString();
  console[level](`[${timestamp}] ${level.toUpperCase()}: ${message}`);
}

const [, , command, ...args] = process.argv;

try {
  switch (command) {
    case "compress": {
      if (args.length < 2 || args.length > 3) {
        throw new Error("Usage: lemem compress <path-to-folder> <path-to-file> [compression-level]");
      }
      let compressionLevel;
      if (args[2] !== undefined) {
        compressionLevel = parseInt(args[2]);
        if (isNaN(compressionLevel) || compressionLevel < 0 || compressionLevel > 9) {
          throw new Error("Compression level must be a number between 0 and 9");
        }
      }
      log("info", `Starting compression of folder ${args[0]}`);
      const map = await fromDirectory(args[0]);
      const buffer = await toArchive(map, { compress: true, compressionLevel });
      await writeFile(args[1], buffer);
      log("info", `Successfully compressed folder ${args[0]} to ${args[1]}`);
      break;
    }
    case "decompress": {
      if (args.length !== 2) {
        throw new Error("Usage: lemem decompress <path-to-file> <path-to-folder>");
      }
      log("info", `Starting decompression of file ${args[0]}`);
      const data = await readFile(args[0]);
      await decompileDirectory(data, args[1], true);
      log("info", `Successfully decompressed file ${args[0]} to folder ${args[1]}`);
      break;
    }
    case "serve": {
      if (args.length < 1 || args.length > 2) {
        throw new Error("Usage: lemem serve <path-to-file> [port]");
      }
      const port = args[1] ? parseInt(args[1]) : 3000;
      log("info", `Starting server for file ${args[0]} on port ${port}`);
      const archiveData = await readFile(args[0]);
      const files = await fromArchive(archiveData, { compressed: true });
      const router = createRouter(files, { alias: { "/": "index.html" } });

      const server = createServer(async (req, res) => {
        try {
          const url = new URL(req.url, `http://localhost:${port}`);
          const request = new Request(url, { method: req.method, headers: req.headers });
          const response = await router(request);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          if (response.body) {
            const buf = Buffer.from(await response.arrayBuffer());
            res.end(buf);
          } else {
            res.end();
          }
        } catch (error) {
          log("error", `Failed to serve: ${error.message}`);
          res.writeHead(500);
          res.end("Internal Server Error");
        }
      });

      server.listen(port, () => {
        log("info", `Server running at http://localhost:${port}`);
      });
      break;
    }
    default:
      throw new Error("Unknown command. Available commands: compress, decompress, serve");
  }
} catch (error) {
  log("error", error.message);
  process.exit(1);
}
