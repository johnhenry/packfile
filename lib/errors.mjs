/**
 * Typed errors thrown by the hardened archive-reading path and the
 * `fromFiles()` adapter. Platform-agnostic (no Node imports) so the browser
 * entrypoint can share it. Every error carries a stable `code` string for
 * programmatic handling; `instanceof` works too.
 */
export class PackfileError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** A path/key failed validation. `reason` is one of: "empty", "not-a-string",
 * "absolute", "backslash", "control-character", "empty-segment",
 * "dot-segment", "traversal", "malformed-encoding", "outside-base",
 * "query-or-fragment", "duplicate". `path` is the offending key as found. */
export class InvalidPathError extends PackfileError {
  constructor(path, reason) {
    super(`packfile: unsafe path ${JSON.stringify(path)} (${reason})`, "ERR_PACKFILE_INVALID_PATH");
    this.path = path;
    this.reason = reason;
  }
}

/** A configured size limit was exceeded. `limit` is "entries" or
 * "totalSize"; `max` is the configured ceiling. */
export class ArchiveLimitError extends PackfileError {
  constructor(limit, max) {
    super(
      limit === "entries"
        ? `packfile: archive has more than ${max} entries (maxEntries)`
        : `packfile: archive exceeds ${max} bytes decompressed (maxTotalSize)`,
      "ERR_PACKFILE_LIMIT"
    );
    this.limit = limit;
    this.max = max;
  }
}

/** The input is not a readable archive (bad gzip stream, not a Web Bundle, ...). */
export class InvalidArchiveError extends PackfileError {
  constructor(message, options) {
    super(`packfile: invalid archive: ${message}`, "ERR_PACKFILE_INVALID_ARCHIVE", options);
  }
}
