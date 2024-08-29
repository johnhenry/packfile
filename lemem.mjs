#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileDirectory } from "./index.mjs";
import { deCompressObject } from "./lib/compression.mjs";
import express from "express";
import { createRouter } from "./index.mjs";
import cbor from "cbor";
import { constants } from "zlib";

// Simple logging function
function log(level, message) {
  const timestamp = new Date().toISOString();
  console[level](`[${timestamp}] ${level.toUpperCase()}: ${message}`);
}

async function compressFolder(inputPath, outputPath, compressionLevel) {
  try {
    log('info', `Starting compression of folder ${inputPath}`);
    const compiledData = await compileDirectory(inputPath, { compress: true, compressionLevel });
    writeFileSync(outputPath, compiledData);
    log('info', `Successfully compressed folder ${inputPath} to ${outputPath}`);
  } catch (error) {
    log('error', `Compression failed: ${error.message}`);
    log('debug', `Error stack: ${error.stack}`);
    throw new Error(`Failed to compress folder: ${error.message}`);
  }
}

async function decompressFile(inputPath, outputPath) {
  try {
    log('info', `Starting decompression of file ${inputPath}`);
    const compiledData = readFileSync(inputPath);
    const decompressed = await deCompressObject(compiledData);
    const decodedObj = cbor.decode(decompressed);
    mkdirSync(outputPath, { recursive: true });
    for (const [filename, fileObj] of Object.entries(decodedObj)) {
      const filePath = join(outputPath, filename);
      writeFileSync(filePath, Buffer.from(fileObj.data));
      log('debug', `Decompressed file: ${filePath}`);
    }
    log('info', `Successfully decompressed file ${inputPath} to folder ${outputPath}`);
  } catch (error) {
    log('error', `Decompression failed: ${error.message}`);
    log('debug', `Error stack: ${error.stack}`);
    throw new Error(`Failed to decompress file: ${error.message}`);
  }
}

function serveFile(filePath, port = 3000) {
  try {
    log('info', `Starting server for file ${filePath} on port ${port}`);
    const app = express();
    const compiledData = readFileSync(filePath);
    const router = createRouter(compiledData, { compressed: true });

    app.get("/*", async (req, res) => {
      const path = req.params[0] || "index.html";
      try {
        log('debug', `Serving path: ${path}`);
        const response = await router("/" + path, {
          alias: { "/": "index.html" },
        });
        res.set("Content-Type", response.headers.get("Content-Type"));
        res.send(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        log('error', `Failed to serve path ${path}: ${error.message}`);
        res.status(404).send("File not found");
      }
    });

    app.listen(port, () => {
      log('info', `Server running at http://localhost:${port}`);
    });
  } catch (error) {
    log('error', `Failed to start server: ${error.message}`);
    log('debug', `Error stack: ${error.stack}`);
    throw new Error(`Failed to start server: ${error.message}`);
  }
}

const [, , command, ...args] = process.argv;

try {
  switch (command) {
    case "compress":
      if (args.length < 2 || args.length > 3) {
        throw new Error("Usage: lemem compress <path-to-folder> <path-to-file> [compression-level]");
      }
      const compressionLevel = args[2] ? parseInt(args[2]) : constants.Z_DEFAULT_COMPRESSION;
      if (isNaN(compressionLevel) || compressionLevel < 0 || compressionLevel > 9) {
        throw new Error("Compression level must be a number between 0 and 9");
      }
      compressFolder(args[0], args[1], compressionLevel);
      break;
    case "decompress":
      if (args.length !== 2) {
        throw new Error("Usage: lemem decompress <path-to-file> <path-to-folder>");
      }
      decompressFile(args[0], args[1]);
      break;
    case "serve":
      if (args.length < 1 || args.length > 2) {
        throw new Error("Usage: lemem serve <path-to-file> [port]");
      }
      serveFile(args[0], args[1] ? parseInt(args[1]) : 3000);
      break;
    default:
      throw new Error("Unknown command. Available commands: compress, decompress, serve");
  }
} catch (error) {
  log('error', error.message);
  process.exit(1);
}
