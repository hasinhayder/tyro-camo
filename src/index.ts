import type { Plugin, ResolvedConfig, UserConfig } from 'vite';
import type { InputOption, PluginContext } from 'rollup';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { CodenameResolver, normalizePath } from './dictionary';
import { DEFAULT_DISCOVER_DIRS, discoverViteEntries, type DiscoverOptions } from './discover';
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

  /** Extensions to camouflage. Defaults to ['js', 'css'] */
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
const DEFAULT_INCLUDE = ['js', 'css'];
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

function appendInput(input: InputOption, additions: string[], root: string): InputOption {
  if (typeof input === 'string') input = [input];
  const named: Record<string, string> = Array.isArray(input)
    ? Object.fromEntries(input.map((value) => [normalizePath(relative(root, value)).replace(/\.[^./]+$/, ''), value]))
    : { ...input };
  for (const addition of additions) named[normalizePath(relative(root, addition)).replace(/\.[^./]+$/, '')] = addition;
  return named;
}

function injectBladeEntries(resolved: ResolvedConfig, dirs: string[]): void {
  if (resolved.command !== 'build' || resolved.build.ssr) return;
  const input = resolved.build.rollupOptions.input;
  if (!input) return;
  const known = new Set(inputValues(input).map(normalizePath));
  const additions: string[] = [];
  const missing: string[] = [];
  for (const entry of discoverViteEntries(resolved.root, dirs)) {
    if (known.has(entry)) continue;
    if (existsSync(resolve(resolved.root, entry))) additions.push(resolve(resolved.root, entry));
    else missing.push(entry);
  }
  if (additions.length) resolved.build.rollupOptions.input = appendInput(input, additions, resolved.root);
  if (missing.length) resolved.logger.warn(`[tyro-camo] Blade templates reference @vite entries that do not exist and were skipped: ${missing.join(', ')}`);
}

export { CodenameResolver, normalizePath } from './dictionary';
export { BYPASS_MARKERS, wrapOutput } from './wrapper';
export { DEFAULT_DISCOVER_DIRS, discoverViteEntries, extractViteEntries } from './discover';
export type { DiscoverOptions } from './discover';
export type { Strategy, WrapperOptions } from './wrapper';
export default tyroCamo;
