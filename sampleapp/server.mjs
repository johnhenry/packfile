import express from "express";
import { readFileSync } from "node:fs";
import { createRouter } from "../index.mjs";

const app = express();
const port = 3000;

const compiledData = readFileSync("./compiled.cbor");
const router = createRouter(compiledData, { compressed: true });

const res = await router("/index.html");

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

app.use(express.static("public"));

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
