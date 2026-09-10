import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizePath } from './dictionary';

export interface DiscoverOptions { enabled?: boolean; dirs?: string[] }
export const DEFAULT_DISCOVER_DIRS = ['resources/views'];
const VITE_DIRECTIVE = /@vite\s*\(([^)]*)\)/g;
const QUOTED_STRING = /['"]([^'"]+)['"]/g;
const EXTERNAL_REFERENCE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export function isExternalReference(value: string): boolean { return EXTERNAL_REFERENCE.test(value); }

export function extractViteEntries(code: string): string[] {
  const entries = new Set<string>();
  for (const directive of code.matchAll(VITE_DIRECTIVE)) {
    const args = directive[1]!.trim();
    if (!args) continue;
    const literals = [...args.matchAll(QUOTED_STRING)].map((match) => match[1]!);
    if (!literals.length) continue;
    if (args.startsWith('[')) for (const literal of literals) entries.add(literal);
    else entries.add(literals[0]!);
  }
  return [...entries].map(normalizePath).filter((entry) => entry !== '' && !isExternalReference(entry));
}

function collectBladeFiles(directory: string, files: string[] = []): string[] {
  let dirents;
  try { dirents = readdirSync(directory, { withFileTypes: true }); } catch { return files; }
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.') || dirent.name === 'node_modules' || dirent.name === 'vendor') continue;
    const full = join(directory, dirent.name);
    if (dirent.isDirectory()) collectBladeFiles(full, files);
    else if (dirent.isFile() && dirent.name.endsWith('.blade.php')) files.push(full);
  }
  return files;
}

export function discoverViteEntries(root: string, dirs: string[] = DEFAULT_DISCOVER_DIRS): string[] {
  const entries = new Set<string>();
  for (const dir of dirs) {
    const base = resolve(root, dir);
    if (!existsSync(base)) continue;
    for (const file of collectBladeFiles(base)) {
      let code: string;
      try { code = readFileSync(file, 'utf8'); } catch { continue; }
      for (const entry of extractViteEntries(code)) entries.add(entry);
    }
  }
  return [...entries].sort();
}
