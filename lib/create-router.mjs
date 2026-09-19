import { buildFileResponse } from "./response.mjs";

export const createRouter = (files, options = {}) => {
  const {
    alias = {},
    cacheControl,
    mimeTypes,
    tryExtensions = [],
    fallback,
  } = options;

  const responseOpts = { cacheControl, mimeTypes };

  const resolve = (path) => {
    if (files.has(path)) return path;
    for (const ext of tryExtensions) {
      const candidate = path + ext;
      if (files.has(candidate)) return candidate;
    }
    return null;
  };

  const notFound = (input, ctx) => {
    if (fallback) return fallback(input, ctx);
    return new Response("Not Found", { status: 404 });
  };

  const handler = async (input, ctx) => {
    let method, filePath, request;

    if (typeof input === "string") {
      method = "GET";
      filePath = input;
      request = null;
    } else {
      request = input;
      method = request.method;
      filePath = new URL(request.url).pathname;
    }

    // Only GET and HEAD allowed
    if (method !== "GET" && method !== "HEAD") {
      if (fallback) return fallback(input, ctx);
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    // Apply aliases
    for (const [aliasPath, targetPath] of Object.entries(alias)) {
      if (filePath === aliasPath) {
        filePath = targetPath;
        break;
      }
    }

    // Remove leading slash
    filePath = filePath.replace(/^\//, "");

    // Look up file, trying extensions if needed
    const resolved = resolve(filePath);
    if (!resolved) return notFound(input, ctx);
    filePath = resolved;

    // Duck-type: if get() returns a Promise (LazyFileMap), await it
    let entry = files.get(filePath);
    if (entry && typeof entry.then === "function") {
      entry = await entry;
    }

    if (!entry) return notFound(input, ctx);

    return buildFileResponse(request, filePath, entry, responseOpts);
  };

  handler.fetch = handler;
  return handler;
};
