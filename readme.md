# LEMEM CLI

LEMEM (Lightweight Embeddable Modular Express Middleware) is a tool for compressing, decompressing, and serving static files.

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-username/lemem.git
cd lemem
npm install
```

## Usage

You can use the LEMEM CLI with the following commands:

### Compress a folder

```bash
npm run lemem compress <path-to-folder> <path-to-file>
```

This command compresses the contents of `<path-to-folder>` and saves the compressed data to `<path-to-file>`.

### Decompress a file

```bash
npm run lemem decompress <path-to-file> <path-to-folder>
```

This command decompresses the contents of `<path-to-file>` and saves the decompressed files to `<path-to-folder>`.

### Serve a compiled file

```bash
npm run lemem serve <path-to-file> [port]
```

This command serves the compiled file at `<path-to-file>` on the specified `[port]` (default is 3000).

## Examples

1. Compress a folder:
   ```bash
   npm run lemem compress ./static ./compiled.cbor
   ```

2. Decompress a file:
   ```bash
   npm run lemem decompress ./compiled.cbor ./decompressed
   ```

3. Serve a compiled file:
   ```bash
   npm run lemem serve ./compiled.cbor 8080
   ```

## License

This project is licensed under the MIT License.
