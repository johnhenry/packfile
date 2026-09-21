import { writeFileSync } from "node:fs";
import { compileDirectory } from "../index.mjs";
import theresWaldo from "theres-waldo";
import { join } from "node:path";
const { dir } = theresWaldo(import.meta.url);
const DIR_STATIC = join(dir, "./static");
const WBN = join(dir, "./compiled.wbn");
const WBN_UNCOMPRESSED = join(dir, "./compiled.uncompressed.wbn");
try {
  writeFileSync(WBN, await compileDirectory(DIR_STATIC));
  writeFileSync(
    WBN_UNCOMPRESSED,
    await compileDirectory(DIR_STATIC, {
      compress: false,
    })
  );
} catch (error) {
  console.error("Compilation failed:", error.message);
}
