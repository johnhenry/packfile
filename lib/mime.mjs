const MIME_TYPES = {
  // Text
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  csv: "text/csv",
  txt: "text/plain",
  xml: "text/xml",
  markdown: "text/markdown",
  md: "text/markdown",

  // JavaScript / JSON
  js: "application/javascript",
  mjs: "application/javascript",
  cjs: "application/javascript",
  json: "application/json",
  jsonld: "application/ld+json",
  map: "application/json",

  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",

  // Fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",

  // Audio / Video
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",

  // Application
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  wasm: "application/wasm",
  bin: "application/octet-stream",

  // Web
  manifest: "application/manifest+json",
  webmanifest: "application/manifest+json",
};

export const getContentType = (filePath, customMimeTypes) => {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  // Plain-object lookups on an attacker/user-influenced key (the file
  // extension) must use an own-property check: MIME_TYPES/customMimeTypes
  // are ordinary object literals, so extensions like "constructor",
  // "__proto__", or "toString" would otherwise resolve to inherited
  // Object.prototype values instead of falling back to the default type.
  if (customMimeTypes && Object.hasOwn(customMimeTypes, extension)) {
    return customMimeTypes[extension];
  }
  if (Object.hasOwn(MIME_TYPES, extension)) {
    return MIME_TYPES[extension];
  }
  return "application/octet-stream";
};
