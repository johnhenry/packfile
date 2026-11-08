import { normalizeGzipHeader } from "./reproducible.mjs";

export const deCompressObject = (compressedData, format = "gzip") => {
  const stream = new Blob([compressedData]).stream();
  const decompressedStream = stream.pipeThrough(
    new DecompressionStream(format)
  );
  return new Response(decompressedStream).arrayBuffer();
};

// `CompressionStream` has no level parameter (it uses the engine's default);
// the gzip OS byte is normalized to Unix, same as the Node implementation.
export const compressObject = async (data, format = "gzip") => {
  const stream = new Blob([data]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream(format));
  const buffer = await new Response(compressedStream).arrayBuffer();
  if (format === "gzip") normalizeGzipHeader(new Uint8Array(buffer));
  return buffer;
};
