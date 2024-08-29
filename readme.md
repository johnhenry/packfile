# Le Mem

Le Mem is a powerful Node.js library designed to compile static directories into a single, efficient binary format using CBOR (Concise Binary Object Representation). This library offers features such as compression, streaming, and caching, making it ideal for serving static assets in web applications or creating efficient archives of directory structures.

## Features

- Compile static folders into a binary CBOR object that can be saved and served as a route
- Optional compression for reduced file size
- Streaming support for large files
- Configurable caching mechanisms
- Alias support for flexible routing
- TypeScript support

## Installation

To install Le Mem, use npm:

```bash
npm install lemem
```

## Usage

### Directory Structure Example

```
├── images/
│   └── icons/
│       ├── one.png
│       ├── two.png
│       └── three.png
├── index.html
```

### Compiling a Directory

```javascript
import { writeFileSync } from "node:fs";
import { compileDirectory } from "./index.mjs";

const PATH_TO_DIRECTORY = "./my-static-assets";
const PATH_TO_COMPILED_CBOR = "./compiled-directory.cbor";
const options = {
  compress: true,
  ignorePatterns: ["*.tmp", ".DS_Store"],
  maxFileSize: 1024 * 1024, // 1MB
};

const compiledDirectory = await compileDirectory(PATH_TO_DIRECTORY, options);
writeFileSync(PATH_TO_COMPILED_CBOR, compiledDirectory);
```

### Decompiling a Directory

```javascript
import { readFileSync } from "node:fs";
import { decompileDirectory } from "./index.mjs";

const PATH_TO_COMPILED_CBOR = "./compiled-directory.cbor";
const PATH_TO_OUTPUT_DIRECTORY = "./decompiled-assets";

const compiledDirectory = await readFileSync(PATH_TO_COMPILED_CBOR);
await decompileDirectory(compiledDirectory, PATH_TO_OUTPUT_DIRECTORY);
```

### Using in Browser

```javascript
const compiledDirectory = await fetch(PATH_TO_DIRECTORY).then((response) =>
  response.arrayBuffer()
);
const router = createRouter(compiledDirectory);
const response = await router("/images/icons/one.png", {
  alias: { "/": "index.html" },
}); // returns HTTP response object representing the file
```

## API Reference

### `compileDirectory(directoryPath: string, options?: CompileOptions): Promise<Buffer>`

Compiles a directory into a CBOR-encoded buffer.

Options:

- `compress`: Boolean (default: false) - Whether to compress the output
- `ignorePatterns`: string[] - Array of glob patterns to ignore
- `maxFileSize`: number (default: 5MB) - Maximum file size before treating as a large file

### `decompileDirectory(compiledData: Buffer, outputPath: string, compressed?: boolean): Promise<void>`

Decompiles a CBOR-encoded buffer back into a directory structure.

### `createRouter(compiledData: Buffer, options?: RouterOptions): (path: string, routeOptions?: RouteOptions) => Promise<Response>`

Creates a router function that can serve files from the compiled data.

Router Options:

- `compressed`: Boolean (default: false) - Whether the input data is compressed
- `cacheControl`: string (default: 'max-age=3600') - Cache-Control header value
- `streamThreshold`: number (default: 5MB) - File size threshold for streaming

Route Options:

- `alias`: Record<string, string> - Path aliases for flexible routing

## Advanced Usage

### Using Aliases

```javascript
const router = createRouter(compiledDirectory);
const response = await router("/api/file.js", {
  alias: { "/api": "/scripts" },
});
```

### Handling Large Files

The library automatically handles large files by streaming them instead of loading them entirely into memory. You can adjust the `streamThreshold` in the router options to control when files should be streamed.

## Error Handling

It's recommended to wrap calls in try-catch blocks for proper error handling:

```javascript
try {
  const compiledData = await compileDirectory("./non-existent-dir");
} catch (error) {
  console.error("Compilation failed:", error.message);
}
```

## TypeScript Support

This library includes TypeScript definitions. You can import types like this:

```typescript
import { CompileOptions, RouterOptions } from "le-mem";
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.
