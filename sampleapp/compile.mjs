import { writeFileSync } from "node:fs";
import { compileDirectory } from "../index.mjs";
import theresWaldo from "theres-waldo";
const { dir } = theresWaldo(import.meta.url);
try {
  let compiledDirectory = await compileDirectory("./static", {
    compress: false,
  });
  writeFileSync("./compiled.uncompressed.cbor", compiledDirectory);
  compiledDirectory = await compileDirectory("./static");
  writeFileSync("./compiled.cbor", compiledDirectory);
  console.log("Directory compiled successfully.");
} catch (error) {
  console.error("Compilation failed:", error.message);
}
