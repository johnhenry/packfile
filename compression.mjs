export const compressObject = async (data, format = "gzip") => {
  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  await writer.write(data);
  await writer.close();
  return typeof window !== "undefined"
    ? new Response(ds.readable).bytes()
    : new Response(ds.readable).arrayBuffer();
};

// Browser-compatible gunzip function
export const deCompressObject = async (data, format = "gzip") => {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  await writer.write(data);
  await writer.close();
  return typeof window !== "undefined"
    ? new Response(ds.readable).bytes()
    : new Response(ds.readable).arrayBuffer();
};
