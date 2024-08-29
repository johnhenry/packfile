import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  compileDirectory,
  decompileDirectory,
  createRouter,
} from "./index.mjs";

const TEST_DIR = "./test_directory";
const COMPILED_FILE = "./compiled_directory.cbor";
const DECOMPILED_DIR = "./decompiled_directory";

await test("Directory Compiler Library", async (t) => {
  // Setup: Create a test directory structure
  await mkdir(join(TEST_DIR, "images", "icons"), { recursive: true });
  await writeFile(
    join(TEST_DIR, "index.html"),
    "<html><body>Test</body></html>"
  );
  await writeFile(
    join(TEST_DIR, "images", "icons", "one.png"),
    "fake png content"
  );
  await writeFile(
    join(TEST_DIR, "images", "icons", "two.png"),
    "another fake png content"
  );

  // Test compileDirectory
  await t.test("compileDirectory should create a CBOR file", async () => {
    const compiledData = await compileDirectory(TEST_DIR);
    await writeFile(COMPILED_FILE, compiledData);
    assert.ok(
      (await readFile(COMPILED_FILE)).length > 0,
      "Compiled file should not be empty"
    );
  });

  // Test decompileDirectory
  await t.test(
    "decompileDirectory should recreate the original structure",
    async () => {
      const compiledData = await readFile(COMPILED_FILE);
      await decompileDirectory(compiledData, DECOMPILED_DIR);

      const originalIndex = await readFile(
        join(TEST_DIR, "index.html"),
        "utf-8"
      );
      const decompiedIndex = await readFile(
        join(DECOMPILED_DIR, "index.html"),
        "utf-8"
      );
      assert.equal(
        decompiedIndex,
        originalIndex,
        "Decompiled index.html should match the original"
      );

      const originalIcon = await readFile(
        join(TEST_DIR, "images", "icons", "one.png"),
        "utf-8"
      );
      const decompiedIcon = await readFile(
        join(DECOMPILED_DIR, "images", "icons", "one.png"),
        "utf-8"
      );
      assert.equal(
        decompiedIcon,
        originalIcon,
        "Decompiled one.png should match the original"
      );
    }
  );

  // Test createRouter
  await t.test("createRouter should serve files correctly", async () => {
    const compiledData = await readFile(COMPILED_FILE);
    const router = createRouter(compiledData);

    const indexResponse = await router("/index.html");
    assert.equal(
      indexResponse.status,
      200,
      "Should return 200 for existing file"
    );
    assert.equal(
      await indexResponse.text(),
      "<html><body>Test</body></html>",
      "Should return correct content"
    );

    const iconResponse = await router("/images/icons/one.png");
    assert.equal(
      iconResponse.status,
      200,
      "Should return 200 for existing file"
    );
    assert.equal(
      await iconResponse.text(),
      "fake png content",
      "Should return correct content"
    );

    const notFoundResponse = await router("/not-exist.txt");
    assert.equal(
      notFoundResponse.status,
      404,
      "Should return 404 for non-existing file"
    );

    const aliasResponse = await router("/", { alias: { "/": "index.html" } });
    assert.equal(aliasResponse.status, 200, "Should handle aliases correctly");
    assert.equal(
      await aliasResponse.text(),
      "<html><body>Test</body></html>",
      "Should return correct content for alias"
    );
  });
}).finally(async () => {
  // Cleanup: Remove test directories and files
  await rm(TEST_DIR, { recursive: true, force: true });
  await rm(COMPILED_FILE, { force: true });
  await rm(DECOMPILED_DIR, { recursive: true, force: true });
});
await test("Directory Compiler Library - Comprehensive Tests", async (t) => {
  // Setup: Create a more complex test directory structure

  await mkdir(join(TEST_DIR, "images", "icons"), { recursive: true });
  await mkdir(join(TEST_DIR, "styles"), { recursive: true });
  await mkdir(join(TEST_DIR, "scripts"), { recursive: true });
  await writeFile(
    join(TEST_DIR, "index.html"),
    "<html><body>Test</body></html>"
  );
  await writeFile(
    join(TEST_DIR, "images", "icons", "one.png"),
    "fake png content"
  );
  await writeFile(
    join(TEST_DIR, "images", "icons", "two.svg"),
    "<svg>fake svg content</svg>"
  );
  await writeFile(join(TEST_DIR, "styles", "main.css"), "body { color: red; }");
  await writeFile(
    join(TEST_DIR, "scripts", "app.js"),
    'console.log("Hello, World!");'
  );
  await writeFile(join(TEST_DIR, ".hidden_file"), "This is a hidden file");

  // Test compileDirectory
  await t.test("compileDirectory - Complex directory", async () => {
    const compiledData = await compileDirectory(TEST_DIR);
    await writeFile(COMPILED_FILE, compiledData);
    assert.ok(
      (await readFile(COMPILED_FILE)).length > 0,
      "Compiled file should not be empty"
    );
  });

  // Test decompileDirectory
  await t.test("decompileDirectory - Complex directory", async () => {
    const compiledData = await readFile(COMPILED_FILE);
    await decompileDirectory(compiledData, DECOMPILED_DIR);

    const compareDirectories = async (dir1, dir2) => {
      const files1 = await readdir(dir1, { withFileTypes: true });
      const files2 = await readdir(dir2, { withFileTypes: true });

      assert.equal(
        files1.length,
        files2.length,
        `Directories ${dir1} and ${dir2} should have the same number of entries`
      );

      for (const file of files1) {
        const path1 = join(dir1, file.name);
        const path2 = join(dir2, file.name);

        if (file.isDirectory()) {
          await compareDirectories(path1, path2);
        } else {
          const content1 = await readFile(path1, "utf-8");
          const content2 = await readFile(path2, "utf-8");
          assert.equal(
            content1,
            content2,
            `File contents should match for ${file.name}`
          );
        }
      }
    };

    await compareDirectories(TEST_DIR, DECOMPILED_DIR);
  });

  // Test createRouter
  await t.test("createRouter - Complex scenarios", async () => {
    const compiledData = await readFile(COMPILED_FILE);
    const router = createRouter(compiledData);

    // Test various file types
    const testCases = [
      {
        path: "/index.html",
        expectedStatus: 200,
        expectedContent: "<html><body>Test</body></html>",
      },
      {
        path: "/images/icons/one.png",
        expectedStatus: 200,
        expectedContent: "fake png content",
      },
      {
        path: "/images/icons/two.svg",
        expectedStatus: 200,
        expectedContent: "<svg>fake svg content</svg>",
      },
      {
        path: "/styles/main.css",
        expectedStatus: 200,
        expectedContent: "body { color: red; }",
      },
      {
        path: "/scripts/app.js",
        expectedStatus: 200,
        expectedContent: 'console.log("Hello, World!");',
      },
      {
        path: "/.hidden_file",
        expectedStatus: 200,
        expectedContent: "This is a hidden file",
      },
      {
        path: "/nonexistent.file",
        expectedStatus: 404,
        expectedContent: "Not Found",
      },
    ];

    for (const testCase of testCases) {
      const response = await router(testCase.path);
      assert.equal(
        response.status,
        testCase.expectedStatus,
        `Status should be ${testCase.expectedStatus} for ${testCase.path}`
      );
      assert.equal(
        await response.text(),
        testCase.expectedContent,
        `Content should match for ${testCase.path}`
      );
    }

    // Test content types
    const contentTypeTestCases = [
      { path: "/index.html", expectedContentType: "text/html" },
      { path: "/images/icons/one.png", expectedContentType: "image/png" },
      { path: "/images/icons/two.svg", expectedContentType: "image/svg+xml" },
      { path: "/styles/main.css", expectedContentType: "text/css" },
      {
        path: "/scripts/app.js",
        expectedContentType: "application/javascript",
      },
      {
        path: "/.hidden_file",
        expectedContentType: "application/octet-stream",
      },
    ];

    for (const testCase of contentTypeTestCases) {
      const response = await router(testCase.path);
      assert.equal(
        response.headers.get("Content-Type"),
        testCase.expectedContentType,
        `Content-Type should be ${testCase.expectedContentType} for ${testCase.path}`
      );
    }

    // Test aliases
    const aliasRouter = createRouter(compiledData);
    const aliasResponse = await aliasRouter("/", {
      alias: { "/": "index.html", "/home": "index.html" },
    });
    assert.equal(
      aliasResponse.status,
      200,
      "Should handle root alias correctly"
    );
    assert.equal(
      await aliasResponse.text(),
      "<html><body>Test</body></html>",
      "Should return correct content for root alias"
    );

    const homeAliasResponse = await aliasRouter("/home", {
      alias: { "/": "index.html", "/home": "index.html" },
    });
    assert.equal(
      homeAliasResponse.status,
      200,
      "Should handle /home alias correctly"
    );
    assert.equal(
      await homeAliasResponse.text(),
      "<html><body>Test</body></html>",
      "Should return correct content for /home alias"
    );
  });

  // Test edge cases
  await t.test("Edge cases", async () => {
    // Empty directory
    const EMPTY_DIR = "./empty_directory";
    await mkdir(EMPTY_DIR, { recursive: true });
    const emptyCompiledData = await compileDirectory(EMPTY_DIR);
    assert.ok(
      emptyCompiledData.length > 0,
      "Compiled data for empty directory should not be empty"
    );

    const emptyRouter = createRouter(emptyCompiledData);
    const emptyResponse = await emptyRouter("/");
    assert.equal(
      emptyResponse.status,
      404,
      "Should return 404 for empty directory"
    );

    // Large file
    const LARGE_FILE = join(TEST_DIR, "large_file.bin");
    const largeContent = Buffer.alloc(10 * 1024 * 1024, "x"); // 10MB file
    await writeFile(LARGE_FILE, largeContent);

    const largeCompiledData = await compileDirectory(TEST_DIR);
    const largeRouter = createRouter(largeCompiledData);
    const largeResponse = await largeRouter("/large_file.bin");
    assert.equal(
      largeResponse.status,
      200,
      "Should handle large files correctly"
    );
    assert.equal(
      (await largeResponse.arrayBuffer()).byteLength,
      10 * 1024 * 1024,
      "Large file content should be correct"
    );

    // Unicode filenames
    const UNICODE_FILE = join(TEST_DIR, "😊_unicode_file.txt");
    await writeFile(UNICODE_FILE, "Unicode content");

    const unicodeCompiledData = await compileDirectory(TEST_DIR);
    const unicodeRouter = createRouter(unicodeCompiledData);
    const unicodeResponse = await unicodeRouter("/😊_unicode_file.txt");
    assert.equal(
      unicodeResponse.status,
      200,
      "Should handle Unicode filenames correctly"
    );
    assert.equal(
      await unicodeResponse.text(),
      "Unicode content",
      "Unicode file content should be correct"
    );

    // Cleanup for edge cases
    await rm(EMPTY_DIR, { recursive: true, force: true });
    await rm(LARGE_FILE, { force: true });
    await rm(UNICODE_FILE, { force: true });
  });
}).finally(async () => {
  // Cleanup: Remove test directories and files
  await rm(TEST_DIR, { recursive: true, force: true });
  await rm(COMPILED_FILE, { force: true });
  await rm(DECOMPILED_DIR, { recursive: true, force: true });
});
test("Directory Compiler Library - New Comprehensive Tests", async (t) => {
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
    const uncompressedData = await compileDirectory(TEST_DIR, {
      compress: false,
    });
    const compressedData = await compileDirectory(TEST_DIR);

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
