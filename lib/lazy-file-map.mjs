import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { hashBuffer } from "./hash.mjs";

export class LazyFileMap {
  #basePath;
  #paths;

  constructor(basePath, paths) {
    this.#basePath = basePath;
    this.#paths = paths;
  }

  has(key) {
    return this.#paths.has(key);
  }

  async get(key) {
    if (!this.#paths.has(key)) return undefined;
    const fullPath = join(this.#basePath, key);
    const [data, stats] = await Promise.all([
      readFile(fullPath),
      stat(fullPath),
    ]);
    const hash = hashBuffer(data);
    return {
      data: new Uint8Array(data),
      size: stats.size,
      hash,
    };
  }

  keys() {
    return this.#paths.keys();
  }

  *values() {
    for (const key of this.#paths) {
      yield this.get(key);
    }
  }

  *entries() {
    for (const key of this.#paths) {
      yield [key, this.get(key)];
    }
  }

  forEach(callback, thisArg) {
    for (const key of this.#paths) {
      callback.call(thisArg, this.get(key), key, this);
    }
  }

  [Symbol.iterator]() {
    return this.entries();
  }

  get size() {
    return this.#paths.size;
  }
}
