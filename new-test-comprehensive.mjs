import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, rm, readdir } from "fs/promises";
import { join } from "path";
import {
  compileDirectory,
  decompileDirectory,
  createRouter,
} from "./index.mjs";

const TEST_DIR = "./new_test_directory";
const COMPILED_FILE = "./new_compiled_directory.cbor";
const DECOMPILED_DIR = "./new_decompiled_directory";

await test("Directory Compiler Library - New Comprehensive Tests", async (t) => {
  // Setup: Create a test directory structure
  await mkdir(join(TEST_DIR, "subdir"), { recursive: true });
  await writeFile(join(TEST_DIR, "small_file.txt"), "Small file content");
  await writeFile(
    join(TEST_DIR, "large_file.bin"),
    Buffer.alloc(6 * 1024 * 1024, "x")
  ); // 6MB file
  await writeFile(
    join(TEST_DIR, "subdir", "ignored_file.txt"),
    "This file should be ignored"
  );

  // Test compression
  await t.test("Compression", async () => {
    const uncompressedData = await compileDirectory(TEST_DIR);
    const compressedData = await compileDirectory(TEST_DIR, { compress: true });

    assert.ok(
      compressedData.length < uncompressedData.length,
      "Compressed data should be smaller"
    );

    const decompressedDir = join(DECOMPILED_DIR, "decompressed");
    await decompileDirectory(compressedData, decompressedDir, true);

    const originalContent = await readFile(
      join(TEST_DIR, "small_file.txt"),
      "utf-8"
    );
    const decompressedContent = await readFile(
      join(decompressedDir, "small_file.txt"),
      "utf-8"
    );
    assert.equal(
      decompressedContent,
      originalContent,
      "Decompressed content should match original"
    );
  });

  // Test streaming
  await t.test("Streaming", async () => {
    const compiledData = await compileDirectory(TEST_DIR);
    const router = createRouter(compiledData, { streamThreshold: 1024 }); // Set low threshold to test streaming

    const smallFileResponse = await router("/small_file.txt");
    console.log(
      "Small file response type:",
      smallFileResponse.body.constructor.name
    );
    assert.equal(smallFileResponse.status, 200, "Small file should be served");
  });

  // Test caching
  await t.test("Caching", async () => {
    const compiledData = await compileDirectory(TEST_DIR);
    const router = createRouter(compiledData, { cacheControl: "max-age=3600" });

    const response = await router("/small_file.txt");
    assert.equal(
      response.headers.get("Cache-Control"),
      "max-age=3600",
      "Cache-Control header should be set correctly"
    );
    assert.ok(response.headers.get("ETag"), "ETag header should be present");
  });

  // Test configuration options
  await t.test("Configuration options", async () => {
    const compiledData = await compileDirectory(TEST_DIR, {
      compress: true,
      ignorePatterns: ["subdir/.*"],
      maxFileSize: 1024, // Set low threshold to test large file handling
    });

    const router = createRouter(compiledData, { compressed: true });

    const ignoredFileResponse = await router("/subdir/ignored_file.txt");
    assert.equal(
      ignoredFileResponse.status,
      404,
      "Ignored file should not be served"
    );

    const largeFileResponse = await router("/large_file.bin");
    assert.equal(largeFileResponse.status, 200, "Large file should be served");
    assert.equal(
      largeFileResponse.body instanceof ReadableStream,
      true,
      "Large file should be streamed"
    );
  });

  // Test error handling
  await t.test("Error handling", async () => {
    await assert.rejects(
      async () => await compileDirectory("/non_existent_directory"),
      { name: "Error", message: /Failed to compile directory/ },
      "Should throw error for non-existent directory"
    );

    await assert.rejects(
      async () =>
        await decompileDirectory(Buffer.from("invalid data"), DECOMPILED_DIR),
      { name: "Error", message: /Failed to decompile directory/ },
      "Should throw error for invalid compiled data"
    );

    const compiledData = await compileDirectory(TEST_DIR);
    const router = createRouter(compiledData);

    const invalidResponse = await router("/non_existent_file.txt");
    assert.equal(
      invalidResponse.status,
      404,
      "Should return 404 for non-existent file"
    );
  });
}).finally(async () => {
  // Cleanup: Remove test directories and files
  await rm(TEST_DIR, { recursive: true, force: true });
  await rm(COMPILED_FILE, { force: true });
  await rm(DECOMPILED_DIR, { recursive: true, force: true });
});
