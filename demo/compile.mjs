import { writeFileSync } from "node:fs";
import { compileDirectory } from "../index.mjs";
import theresWaldo from "theres-waldo";
import { join } from "node:path";
const { dir } = theresWaldo(import.meta.url);
const DIR_STATIC = join(dir, "./static");
const CBOR = join(dir, "./compiled.cbor");
const CBOR_UNCOMPRESSED = join(dir, "./compiled.uncompressed.cbor");
try {
  writeFileSync(CBOR, await compileDirectory(DIR_STATIC));
  writeFileSync(
    CBOR_UNCOMPRESSED,
    await compileDirectory(DIR_STATIC, {
      compress: false,
    })
  );
} catch (error) {
  console.error("Compilation failed:", error.message);
}
