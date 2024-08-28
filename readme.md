# Le Mem

Compile static folder into a binary CBOR object that can be saved and served as a route.

Please create a library that can compile local static directory into a binary CBOR object.
This object can be saved as a file or served and served as with a mock http router.

Please ask questions if you are not clear on what i'm asking. Thanks in advace!

## Usage

directory

```
├── images/
│   └── icons/
│       ├── one.png
│       ├── two.png
│       └── three.png
├── index.html
```

### Example: Compile Directory

```javascript
import { writeFileSync } from "node:fs";
import { compileDirectory } from "./index.mjs";
const compiledDirectory = await compileDirectory(PATH_TO_DIRECTORY);
writeFileSync(PATH_TO_COMPILED_CBOR, compiledDirectory);
```

### Example: Decompile Directory

```javascript
import { readFileSync } from "node:fs";
import { decompileDirectory } from "./index.mjs";
const compiledDirectory = await readFileSync(PATH_TO_DIRECTORY);
await decompileDirectory(compiledDirectory, PATH_TO_DIRECTORY);
```

### Example: Use in browser.

```javascript
const compiledDirectory = await fetch(PATH_TO_DIRECTORY).then((response) =>
  response.bytes()
);
const router = createRouter(compiledDirectory);
const response = await router("/images/icons/one.png", {
  alias: { "/": "index.html" },
}); // returns HTTP response object represnting the file
```
