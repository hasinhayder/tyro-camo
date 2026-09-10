import type { OutputOptions } from 'rollup';
import { isAbsolute, relative } from 'node:path';
import { CodenameResolver, normalizePath } from './dictionary';

export type Strategy = 'codename' | 'nameless' | 'preserve';

/**
 * Legend values used for targeted files that were deliberately left without a codename.
 * The brackets guarantee these can never collide with a real codename (codenames are
 * lowercase `[a-z0-9-]` only).
 */
export const BYPASS_MARKERS: Record<Exclude<Strategy, 'codename'>, string> = {
  nameless: '[nameless]',
  preserve: '[preserve]',
};

export interface WrapperOptions {
  aliases: Record<string, string>;
  format: string;
  include: string[];
  unmappedStrategy: Strategy;
  resolver: CodenameResolver;
  root?: string;
  assetsDir?: string;
  onBypass?: (source: string, strategy: Exclude<Strategy, 'codename'>) => void;
}

/** The subset of Rollup's `PreRenderedChunk` / `PreRenderedAsset` this plugin inspects. */
export interface OutputPatternInfo {
  type?: 'chunk' | 'asset';
  name?: string;
  fileName?: string;
  originalFileName?: string | null;
  facadeModuleId?: string | null;
  moduleIds?: string[];
  source?: unknown;
}

/**
 * Vite calls `assetFileNames` with a synthetic asset to learn the output *directory* used when
 * rewriting `url()` references in CSS, and marks the call as internal:
 *
 *     assetFileNames({ type: 'asset', name, originalFileName: null,
 *                      source: '/* vite internal call, ignore *\/' })
 *
 * Only `path.dirname()` of the result is used. Treating it as a real asset would consume a
 * codename from the pool and record a phantom entry in the legend for a file never emitted.
 */
const VITE_INTERNAL_CALL = '/* vite internal call, ignore */';

type Pattern = string | ((info: any) => string);
type Kind = 'entry' | 'chunk' | 'asset';

const ANONYMOUS = 'anonymous';

function extensionOf(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const match = normalizePath(value).match(/\.([^./\\]+)$/);
  return match ? match[1].toLowerCase() : '';
}

/** Absolute paths outside the project root are unusable as stable, machine-independent identities. */
function usableAbsolute(value: string, root?: string): boolean {
  if (!root || !isAbsolute(value)) return true;
  const rel = relative(root, value);
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

function relativize(value: string, root?: string): string {
  if (!root || !isAbsolute(value)) return normalizePath(value);
  return normalizePath(relative(root, value));
}

/**
 * Stable identity of the file being named.
 *
 * A chunk's `name` carries no extension, `facadeModuleId` is `null` for shared chunks and
 * `originalFileName` is `null` for some assets - so every available field is probed, in
 * preference order, until one yields a project-relative path.
 */
function identityOf(info: OutputPatternInfo, options: WrapperOptions): string {
  const candidates = [
    info.originalFileName,
    info.facadeModuleId,
    Array.isArray(info.moduleIds) ? info.moduleIds[0] : '',
    info.name,
    info.fileName,
  ];

  let fallback = '';
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    if (!usableAbsolute(candidate, options.root)) continue;
    const identity = relativize(candidate, options.root);
    if (!identity) continue;
    if (!identity.startsWith('..')) return identity;
    if (!fallback) fallback = identity;
  }
  return fallback || ANONYMOUS;
}

/**
 * Extensions whose sources are compiled to JavaScript before Rollup names the output.
 *
 * A `.ts`, `.tsx`, `.vue` or `.mjs` source never reaches a naming hook as itself - by then it is a
 * JavaScript chunk whose `name` carries no extension at all. Listing any of these in `include`
 * therefore targets chunks, exactly as `'js'` does, so `include: ['ts', 'css']` camouflages
 * TypeScript entries instead of silently doing nothing.
 */
const SCRIPT_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte']);

/**
 * Rollup emits JavaScript for every chunk, so a chunk is camouflaged whenever any script extension
 * is targeted - even though its `name` has no extension. Assets are classified by their real
 * extension so fonts, images and other custom pipelines keep delegating to the user's handler.
 */
function isTargeted(info: OutputPatternInfo, include: Set<string>): boolean {
  if (info.type === 'chunk') {
    for (const extension of include) if (SCRIPT_EXTENSIONS.has(extension)) return true;
    return false;
  }
  const ext = extensionOf(info.originalFileName) || extensionOf(info.name) || extensionOf(info.fileName);
  return Boolean(ext) && include.has(ext);
}

function defaultPattern(kind: Kind, options: WrapperOptions): string {
  const dir = options.assetsDir || 'assets';
  return kind === 'asset' ? `${dir}/[name]-[hash][extname]` : `${dir}/[name]-[hash].js`;
}

function render(format: string, codename: string, kind: Kind, reference: string | undefined): string {
  let result = format.replace(/\[codename\]/g, codename);
  if (kind !== 'asset' && result.includes('[extname]')) {
    // Derive the extension from the pattern the user (or Vite) would have used, so custom
    // `.cjs`/`.mjs` outputs are honoured instead of always forcing `.js`.
    result = result.replace(/\[extname\]/g, `.${extensionOf(reference) || 'js'}`);
  }
  return result;
}

function isViteInternalCall(info: OutputPatternInfo): boolean {
  return info.source === VITE_INTERNAL_CALL;
}

function wrap(pattern: Pattern | undefined, kind: Kind, options: WrapperOptions): Pattern {
  const include = new Set(options.include.map((ext) => ext.replace(/^\./, '').toLowerCase()));
  const fallback = defaultPattern(kind, options);

  return (info: OutputPatternInfo) => {
    const original = typeof pattern === 'function' ? pattern(info) : pattern;

    // Answer Vite's internal directory probe with the untouched pattern: no codename is resolved
    // and nothing is recorded, while the caller still gets the directory it asked for.
    if (isViteInternalCall(info)) return original ?? fallback;
    if (!isTargeted(info, include)) return original ?? fallback;

    const source = identityOf(info, options);
    // Aliases are exact, project-root-relative source paths. A partial or basename-only key
    // never matches, so an alias can not be stolen by an unrelated same-named file.
    const alias = options.aliases[source];

    if (!alias && options.unmappedStrategy !== 'codename') {
      options.onBypass?.(source, options.unmappedStrategy);
      if (options.unmappedStrategy === 'preserve') return original ?? fallback;
      return kind === 'asset' ? `${options.assetsDir || 'assets'}/[hash][extname]` : `${options.assetsDir || 'assets'}/[hash].js`;
    }

    return render(options.format, options.resolver.resolve(source, alias), kind, original ?? fallback);
  };
}

export function wrapOutput(
  output: OutputOptions | OutputOptions[] | string | undefined,
  options: WrapperOptions,
): OutputOptions | OutputOptions[] {
  const wrapOne = (item: OutputOptions | string | undefined): OutputOptions => {
    const base: OutputOptions = typeof item === 'string' ? { dir: item } : { ...(item ?? {}) };
    return {
      ...base,
      entryFileNames: wrap(base.entryFileNames, 'entry', options),
      chunkFileNames: wrap(base.chunkFileNames, 'chunk', options),
      assetFileNames: wrap(base.assetFileNames, 'asset', options),
    };
  };

  return Array.isArray(output) ? output.map(wrapOne) : wrapOne(output);
}
