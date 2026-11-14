import { existsSync } from 'fs';
import * as path from 'path';

/** The image ships `src/assets` as `./assets`; a development run starts from the package, beside `src/`. */
const ROOTS = [path.join(process.cwd(), 'assets'), path.join(process.cwd(), 'src', 'assets')];

/** Where a bundled asset lives, whether the engine runs from its image or from the sources. */
export function assetPath(...parts: string[]): string {
  const root = ROOTS.find((candidate) => existsSync(candidate)) ?? ROOTS[0];
  return path.join(root, ...parts);
}
