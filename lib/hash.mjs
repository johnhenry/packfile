import { createHash } from "node:crypto";

export const hashBuffer = (buffer) => {
  return createHash("sha256").update(buffer).digest("hex");
};

export const hashStream = (stream) => {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
};
