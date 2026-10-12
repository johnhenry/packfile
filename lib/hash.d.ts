/// <reference types="node" />
/** SHA-256 hex digest of a Buffer/Uint8Array (Node only: uses `node:crypto`). */
export function hashBuffer(buffer: Uint8Array): string;

/** SHA-256 hex digest of a Node.js Readable stream. */
export function hashStream(stream: NodeJS.ReadableStream): Promise<string>;
