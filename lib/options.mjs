/**
 * Resolve a boolean option that has a canonical name and an alias
 * (`compress` / `compressed`). If both are given and disagree, that's a
 * caller bug -- throw rather than silently pick one.
 */
export const aliasedOption = (opts, canonical, alias, fallback) => {
  const a = opts?.[canonical];
  const b = opts?.[alias];
  if (a !== undefined && b !== undefined && Boolean(a) !== Boolean(b)) {
    throw new TypeError(
      `packfile: conflicting options \`${canonical}\` and \`${alias}\` (they are aliases; pass one)`
    );
  }
  return a ?? b ?? fallback;
};
