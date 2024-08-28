export type FileInfo = {
  type: "content" | "large-file";
  data?: Buffer;
  path?: string;
  hash?: string;
};

export type CompiledFiles = { [path: string]: FileInfo };

export type CompileOptions = {
  compress?: boolean;
  ignorePatterns?: string[];
  maxFileSize?: number;
};

export type RouterOptions = {
  alias?: { [key: string]: string };
  cacheMaxAge?: number;
};
