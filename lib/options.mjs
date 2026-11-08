/**
 * Resolve an option that has a canonical name and an alias
 * (`compress` / `compressed`). If both are given and disagree, that's a
 * caller bug -- throw rather than silently pick one. Booleans compare by
 * truthiness; a string value (`"auto"`) must match exactly.
 */
export const aliasedOption = (opts, canonical, alias, fallback) => {
  const a = opts?.[canonical];
  const b = opts?.[alias];
  const norm = (v) => (typeof v === "string" ? v : Boolean(v));
  if (a !== undefined && b !== undefined && norm(a) !== norm(b)) {
    throw new TypeError(
      `packfile: conflicting options \`${canonical}\` and \`${alias}\` (they are aliases; pass one)`
    );
  }
  return a ?? b ?? fallback;
};

/** gzip streams start with the magic bytes 1f 8b (RFC 1952). A Web Bundle
 * starts with a CBOR array header (0x85/0x86), so the two never collide. */
export const isGzip = (bytes) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

/**
 * `fromArchive()`'s `compressed` option (alias `compress`): `true` forces
 * gunzip, `false` forces a plain Web Bundle, `"auto"` (the default) decides
 * by the gzip magic bytes. Returns a boolean for these `bytes`.
 */
export const resolveCompressed = (opts, bytes) => {
  const value = aliasedOption(opts, "compressed", "compress", "auto");
  if (typeof value === "string" && value !== "auto") {
    throw new TypeError(`packfile: compressed must be true, false or "auto", got ${JSON.stringify(value)}`);
  }
  if (value !== "auto") return Boolean(value);
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  return isGzip(view);
};
