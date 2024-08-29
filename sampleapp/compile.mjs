import { writeFileSync } from "node:fs";
import { compileDirectory } from "../index.mjs";

try {
  const compiledDirectory = await compileDirectory("./static", {
    compress: true,
  });
  writeFileSync("./compiled.cbor", compiledDirectory);
  console.log("Directory compiled successfully.");
} catch (error) {
  console.error("Compilation failed:", error.message);
}
