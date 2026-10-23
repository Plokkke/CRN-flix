import * as path from 'path';

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.flv', '.ts', '.webm']);

/** Only videos are media: release side files (`.nfo`, `.txt`, artwork…) are never identified nor placed. */
export const isVideoFile = (filePath: string): boolean => VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
