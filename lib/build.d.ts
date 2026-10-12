export interface BuildChunk { type: "chunk"; fileName: string; code: string }
export interface BuildAsset { type: "asset"; fileName: string; source: string | Uint8Array }
export interface ExportResult {
  archive: Uint8Array;
  /** SHA-256 hex digest of the archive bytes; not a p2pws CID. */
  sha256: string;
  files: Array<{ path: string; size: number; sha256: string; contentType: string }>;
}
export function exportFiles(files: Record<string, string | Uint8Array>): Promise<ExportResult>;
export function exportBuild(output: readonly (BuildChunk | BuildAsset)[]): Promise<ExportResult>;
