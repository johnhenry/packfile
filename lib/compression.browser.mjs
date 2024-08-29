export const deCompressObject = (compressedData, format = "gzip") => {
  const stream = new Blob([compressedData]).stream();
  const decompressedStream = stream.pipeThrough(
    new DecompressionStream(format)
  );
  return new Response(decompressedStream).arrayBuffer();
};

export const compressObject = (data, format = "gzip") => {
  const stream = new Blob([data]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream(format));
  return new Response(compressedStream).arrayBuffer();
};
