#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileDirectory } from "./index.mjs";
import { deCompressObject } from "./lib/compression.mjs";
import express from "express";
import { createRouter } from "./index.mjs";
import cbor from "cbor";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);
// import theresWaldo from "theres-waldo";
// const { dir } = theresWaldo(import.meta.url);
async function compressFolder(inputPath, outputPath) {
  try {
    const compiledData = await compileDirectory(inputPath, { compress: true });
    writeFileSync(outputPath, compiledData);
    console.log(`Compressed folder ${inputPath} to ${outputPath}`);
  } catch (error) {
    console.error("Compression failed:", error.message);
  }
}

async function decompressFile(inputPath, outputPath) {
  try {
    const compiledData = readFileSync(inputPath);
    const decompressed = await deCompressObject(compiledData);
    const decodedObj = cbor.decode(decompressed);
    mkdirSync(outputPath, { recursive: true });
    for (const [filename, fileObj] of Object.entries(decodedObj)) {
      const filePath = join(outputPath, filename);
      writeFileSync(filePath, Buffer.from(fileObj.data));
    }
    console.log(`Decompressed file ${inputPath} to folder ${outputPath}`);
  } catch (error) {
    console.error("Decompression failed:", error.message);
  }
}

function serveFile(filePath, port = 3000) {
  const app = express();
  const compiledData = readFileSync(filePath);
  const router = createRouter(compiledData, { compressed: true });

  app.get("/*", async (req, res) => {
    const path = req.params[0] || "index.html";
    try {
      const response = await router("/" + path, {
        alias: { "/": "index.html" },
      });
      res.set("Content-Type", response.headers.get("Content-Type"));
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error(error);
      res.status(404).send("File not found");
    }
  });

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

const [, , command, ...args] = process.argv;

switch (command) {
  case "compress":
    if (args.length !== 2) {
      console.error("Usage: lemem compress <path-to-folder> <path-to-file>");
      process.exit(1);
    }
    compressFolder(args[0], args[1]);
    break;
  case "decompress":
    if (args.length !== 2) {
      console.error("Usage: lemem decompress <path-to-file> <path-to-folder>");
      process.exit(1);
    }
    decompressFile(args[0], args[1]);
    break;
  case "serve":
    if (args.length < 1 || args.length > 2) {
      console.error("Usage: lemem serve <path-to-file> [port]");
      process.exit(1);
    }
    serveFile(args[0], args[1] ? parseInt(args[1]) : 3000);
    break;
  default:
    console.error(
      "Unknown command. Available commands: compress, decompress, serve"
    );
    process.exit(1);
}
