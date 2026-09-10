import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { normalizePath } from './dictionary';

export interface DiscoverOptions {
  /** Enable Blade discovery. Defaults to true. */
  enabled?: boolean;

  /** Directories (relative to the project root) scanned for `*.blade.php` files. */
  dirs?: string[];
}

/** Directories scanned for Blade templates by default. */
export const DEFAULT_DISCOVER_DIRS = ['resources/views'];

/** Opening of a `@vite(` directive. The arguments are parsed by `readFirstArgument`. */
const VITE_DIRECTIVE = /@vite\s*\(/g;

/** Blade comments: a commented-out directive must never register an entry. */
const BLADE_COMMENT = /\{\{--[\s\S]*?--\}\}/g;

const QUOTED_STRING = /'([^']*)'|"([^"]*)"/g;

const EXTERNAL_REFERENCE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Extensions accepted for a bare filename such as `app.js`. A literal with no directory part
 * is only treated as an entry when it carries one of these, so a PHP call nested in the array -
 * `@vite(['resources/js/app.js', config('app.name')])` - is not mistaken for a file path.
 */
const ENTRY_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sass', 'less', 'styl', 'vue', 'svelte',
]);

export function isExternalReference(value: string): boolean {
  return EXTERNAL_REFERENCE.test(value);
}

/**
 * Read the first argument of a directive, starting just after its opening parenthesis.
 *
 * `@vite` takes `@vite(entry, buildDirectory)`, where the second argument is a build directory
 * rather than an entry. Tracking bracket depth and string literals means a nested array, a `)`
 * inside a string, or that trailing build directory can never be mistaken for the entry list.
 */
function readFirstArgument(code: string, start: number): { argument: string; end: number } {
  let depth = 0;
  let quote = '';

  for (let index = start; index < code.length; index += 1) {
    const char = code[index]!;

    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '[' || char === '{' || char === '(') {
      depth += 1;
      continue;
    }

    if (char === ']' || char === '}') {
      if (depth > 0) depth -= 1;
      continue;
    }

    if (char === ')') {
      if (depth > 0) depth -= 1;
      else return { argument: code.slice(start, index), end: index };
      continue;
    }

    if (char === ',' && depth === 0) return { argument: code.slice(start, index), end: index };
  }

  return { argument: code.slice(start), end: code.length };
}

function collectLiterals(argument: string): string[] {
  const literals: string[] = [];
  for (const match of argument.matchAll(QUOTED_STRING)) {
    const value = match[1] ?? match[2] ?? '';
    if (value) literals.push(value);
  }
  return literals;
}

/** A literal is an entry when it has a directory part, or a bare filename with a known extension. */
function looksLikeEntry(value: string): boolean {
  if (value.includes('/') || value.includes('\\')) return true;
  const extension = value.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return Boolean(extension && ENTRY_EXTENSIONS.has(extension));
}

/**
 * Extract every source path referenced by `@vite()` directives in a Blade template.
 *
 * Only the first argument is considered: `@vite(['resources/js/app.js'], 'public/build')`
 * registers one entry, not `public/build`. Directives whose arguments are PHP variables cannot
 * be resolved statically and are skipped, as are external URLs, which Laravel serves without
 * consulting the manifest.
 */
export function extractViteEntries(code: string): string[] {
  const source = code.replace(BLADE_COMMENT, ' ');
  const entries = new Set<string>();

  VITE_DIRECTIVE.lastIndex = 0;
  let directive: RegExpExecArray | null;

  while ((directive = VITE_DIRECTIVE.exec(source))) {
    const { argument, end } = readFirstArgument(source, directive.index + directive[0].length);
    VITE_DIRECTIVE.lastIndex = end;

    const trimmed = argument.trim();
    if (!trimmed) continue;

    const literals = collectLiterals(trimmed).filter(looksLikeEntry);
    if (!literals.length) continue;

    // `@vite(['a.css', 'b.js'])` lists several entries; `@vite('a.js')` lists exactly one.
    if (trimmed.startsWith('[')) for (const literal of literals) entries.add(literal);
    else entries.add(literals[0]!);
  }

  return [...entries]
    // External references are tested before normalization: `normalizePath` strips leading
    // slashes, which would turn a protocol-relative `//cdn.example.com/app.js` into a
    // project-relative path and defeat the check.
    .filter((entry) => entry !== '' && !isExternalReference(entry))
    .map((entry) => normalizePath(entry))
    .filter((entry) => entry !== '');
}

function collectBladeFiles(directory: string, files: string[] = []): string[] {
  let dirents;
  try {
    dirents = readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const dirent of dirents) {
    if (dirent.name.startsWith('.') || dirent.name === 'node_modules' || dirent.name === 'vendor') continue;
    const full = join(directory, dirent.name);
    if (dirent.isDirectory()) collectBladeFiles(full, files);
    else if (dirent.isFile() && dirent.name.endsWith('.blade.php')) files.push(full);
  }
  return files;
}

/** Scan Blade templates below `dirs` and return every root-relative `@vite()` entry they reference. */
export function discoverViteEntries(root: string, dirs: string[] = DEFAULT_DISCOVER_DIRS): string[] {
  const entries = new Set<string>();

  for (const dir of dirs) {
    const base = resolve(root, dir);
    if (!isFile(base) && !isDirectory(base)) continue;

    for (const file of collectBladeFiles(base)) {
      let code: string;
      try {
        code = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const entry of extractViteEntries(code)) entries.add(entry);
    }
  }

  return [...entries].sort();
}

/** True when `path` exists and is a regular file. */
export function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** True when `path` exists and is a directory. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
