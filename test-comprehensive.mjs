import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import {
  compileDirectory,
  decompileDirectory,
  createRouter,
} from "./index.mjs";

const TEST_DIR = "./test_directory";
const COMPILED_FILE = "./compiled_directory.cbor";
const DECOMPILED_DIR = "./decompiled_directory";

test("Directory Compiler Library - Comprehensive Tests", async (t) => {
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

  // Cleanup: Remove test directories and files
  await t.test("Cleanup", async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await rm(COMPILED_FILE, { force: true });
    await rm(DECOMPILED_DIR, { recursive: true, force: true });
  });
});
