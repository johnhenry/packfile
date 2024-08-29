import { readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { createRouter } from "../index.mjs";
import theresWaldo from "theres-waldo";
const { dir } = theresWaldo(import.meta.url);

const app = express();
const port = 3000;

const compiledData = readFileSync(join(dir, "./compiled.cbor"));
const router = createRouter(compiledData, { compressed: true });
app.get("/compiled/*", async (req, res) => {
  const path = req.params[0];
  try {
    const response = await router("/" + path, { alias: { "/": "index.html" } });
    res.set("Content-Type", response.headers.get("Content-Type"));
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    res.status(404).send("File not found");
  }
});
app.use(express.static(dir));
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
