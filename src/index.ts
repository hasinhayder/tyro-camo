import type { Plugin, ResolvedConfig, UserConfig } from 'vite';
import type { InputOption, PluginContext } from 'rollup';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { CodenameResolver, normalizePath } from './dictionary';
import { DEFAULT_DISCOVER_DIRS, discoverViteEntries, isDirectory, isFile, type DiscoverOptions } from './discover';
import { BYPASS_MARKERS, wrapOutput, type Strategy, type WrapperOptions } from './wrapper';

export interface TyroCamoOptions {
  /**
   * Explicit mapping of project-root-relative source paths to fixed codenames.
   * Keys must match the source path exactly (e.g. `resources/js/player.js`).
   */
  aliases?: Record<string, string>;

  /** Naming template for targeted assets. Defaults to 'assets/[codename]-[hash][extname]' */
  format?: string;

  /** Strategy for chunks not explicitly listed in aliases: 'codename' | 'nameless' | 'preserve' */
  unmappedStrategy?: Strategy;

  /**
   * Extensions to camouflage. Defaults to `['js', 'ts', 'css']`.
   *
   * Script extensions (`js`, `ts`, `tsx`, `jsx`, `mjs`, `cjs`, `vue`, `svelte`) all target
   * JavaScript chunks, because those sources are compiled before Rollup names the output.
   * Any other extension targets emitted assets by their real extension.
   */
  include?: string[];

  /** Optional custom word lists to replace the built-in words */
  words?: {
    adjectives?: string[];
    nouns?: string[];
  };

  /** Optional deterministic seed for rotating generated codenames. */
  seed?: string;

  /** Output mapping legend for debugging / auditing */
  legend?: {
    enabled?: boolean;
    path?: string; // defaults to '.camo-legend.json'
  };
  discover?: DiscoverOptions;
}

const DEFAULT_FORMAT = 'assets/[codename]-[hash][extname]';
const DEFAULT_INCLUDE = ['js', 'ts', 'css'];
const DEFAULT_LEGEND_PATH = '.camo-legend.json';

export function tyroCamo(options: TyroCamoOptions = {}): Plugin {
  const resolver = new CodenameResolver({ ...options.words, seed: options.seed });
  const aliases = Object.fromEntries(
    Object.entries(options.aliases ?? {}).map(([source, codename]) => [normalizePath(source), codename]),
  );
  const bypassed = new Map<string, string>();

  const legendPath = options.legend?.path ?? DEFAULT_LEGEND_PATH;
  const legendEnabled = options.legend?.enabled ?? Boolean(options.legend?.path);
  const discoverEnabled = options.discover?.enabled ?? true;
  const discoverDirs = options.discover?.dirs ?? DEFAULT_DISCOVER_DIRS;

  const wrapper: WrapperOptions = {
    aliases,
    format: options.format ?? DEFAULT_FORMAT,
    include: options.include ?? DEFAULT_INCLUDE,
    unmappedStrategy: options.unmappedStrategy ?? 'codename',
    resolver,
    root: process.cwd(),
    assetsDir: 'assets',
    onBypass: (source, strategy) => {
      if (source) bypassed.set(source, BYPASS_MARKERS[strategy]);
    },
  };

  let warnedAboutLegend = false;

  return {
    name: 'tyro-camo',

    config(config: UserConfig) {
      // The wrapped output must be assigned in place: returning it would make Vite's
      // `mergeConfig` concatenate arrays, duplicating every entry of a multi-output config.
      config.build ??= {};
      config.build.rollupOptions ??= {};
      config.build.rollupOptions.output = wrapOutput(config.build.rollupOptions.output, wrapper);
    },

    configResolved(config: ResolvedConfig) {
      wrapper.root = config.root;
      wrapper.assetsDir = config.build.assetsDir || 'assets';
      if (discoverEnabled) injectBladeEntries(config, discoverDirs);
    },

    async writeBundle(this: PluginContext) {
      const warn = (message: string) => {
        if (typeof this?.warn === 'function') this.warn(message);
        else console.warn(`[tyro-camo] ${message}`);
      };

      if (bypassed.size > 0) {
        warn(
          `${bypassed.size} targeted file(s) were not camouflaged because unmappedStrategy is "${wrapper.unmappedStrategy}": `
          + `${[...bypassed.keys()].sort().join(', ')}`,
        );
      }

      if (!legendEnabled) return;

      const entries: Record<string, string> = { ...resolver.entries() };
      for (const [source, marker] of bypassed) {
        if (!(source in entries)) entries[source] = marker;
      }
      const legend = Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));

      const target = resolve(wrapper.root ?? process.cwd(), legendPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(legend, null, 2)}\n`, 'utf8');

      if (!warnedAboutLegend) {
        warnedAboutLegend = true;
        warn(`wrote the codename legend to ${target} - keep it secret, out of public web roots, and add it to .gitignore.`);
      }
    },
  };
}

function inputValues(input: InputOption | undefined): string[] {
  if (typeof input === 'string') return [input];
  if (Array.isArray(input)) return input.filter((value): value is string => typeof value === 'string');
  if (input && typeof input === 'object') return Object.values(input).filter((value): value is string => typeof value === 'string');
  return [];
}

/**
 * Absolute form of an input value. `normalizePath` only handles source paths, so an already
 * absolute filesystem path must not be pushed through it - doing so turns `/app/resources/js/a.js`
 * into `app/resources/js/a.js`, which never matches a discovered entry and silently duplicates it.
 */
function absoluteInput(value: string, root: string): string {
  return normalizePath(isAbsolute(value) ? resolve(value) : resolve(root, value));
}

/**
 * Append discovered entries while preserving the caller's input shape.
 *
 * Rewriting an array into a keyed object would change Rollup's `[name]` from the basename to the
 * full relative key (so `preserve`/custom patterns start emitting `assets/resources/js/app-<hash>.js`),
 * and keys derived by stripping the extension can collide - `theme.js` and `theme.mjs` would become
 * one entry and an entry would silently vanish from the manifest. New object keys therefore keep
 * their extension, and arrays stay arrays (Rollup deduplicates identical absolute paths for us).
 */
function appendInput(input: InputOption, additions: string[], root: string): InputOption {
  if (typeof input === 'string') return [input, ...additions];
  if (Array.isArray(input)) return [...input, ...additions];

  const named: Record<string, string> = { ...input };
  for (const addition of additions) named[normalizePath(relative(root, addition))] = addition;
  return named;
}

/**
 * laravel-vite-plugin builds only the entries in its own `input` option, so an extra `@vite()`
 * reference in a Blade template never reaches the manifest and makes Laravel throw
 * "Unable to locate file in Vite manifest" at runtime. Discovered entries are appended to the
 * resolved Rollup inputs here: every plugin's `config` hook (including laravel-vite-plugin's
 * `enforce: 'post'` hook that sets `input`) has already run, but Vite reads
 * `build.rollupOptions.input` for bundling only when the build starts, after all `configResolved`
 * hooks - so the in-place mutation cannot be overwritten.
 */
function injectBladeEntries(resolved: ResolvedConfig, dirs: string[]): void {
  if (resolved.command !== 'build' || resolved.build.ssr) return;

  const input = resolved.build.rollupOptions.input;
  if (!input) return; // entry-less (e.g. index.html) builds are not Laravel entry builds

  const known = new Set(inputValues(input).map((value) => absoluteInput(value, resolved.root)));
  const additions: string[] = [];
  const missing: string[] = [];
  const notFiles: string[] = [];

  for (const entry of discoverViteEntries(resolved.root, dirs)) {
    const absolute = resolve(resolved.root, entry);
    if (known.has(normalizePath(absolute))) continue;
    if (!isFile(absolute)) {
      // Distinguish "missing" from "exists but is a directory" - a directory such as a previous
      // build output must never be injected as an entry.
      (isDirectory(absolute) ? notFiles : missing).push(entry);
      continue;
    }
    additions.push(absolute);
    known.add(normalizePath(absolute));
  }

  if (additions.length) {
    resolved.build.rollupOptions.input = appendInput(input, additions, resolved.root);
    const names = additions.map((addition) => normalizePath(relative(resolved.root, addition))).join(', ');
    resolved.logger.info(`[tyro-camo] added ${additions.length} @vite entries discovered in Blade templates: ${names}`);
  }

  if (missing.length) {
    resolved.logger.warn(
      `[tyro-camo] Blade templates reference @vite entries that do not exist and were skipped: ${missing.join(', ')}`,
    );
  }

  if (notFiles.length) {
    resolved.logger.warn(
      `[tyro-camo] Blade templates reference @vite paths that are not files and were skipped: ${notFiles.join(', ')}`,
    );
  }
}

export { CodenameResolver, normalizePath } from './dictionary';
export { BYPASS_MARKERS, wrapOutput } from './wrapper';
export { DEFAULT_DISCOVER_DIRS, discoverViteEntries, extractViteEntries } from './discover';
export type { DiscoverOptions } from './discover';
export type { Strategy, WrapperOptions } from './wrapper';
export default tyroCamo;
