import type { Plugin, UserConfig } from 'vite';
import type { PluginContext } from 'rollup';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CodenameResolver, normalizePath } from './dictionary';
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

  /** Output mapping legend for debugging / auditing */
  legend?: {
    enabled?: boolean;
    path?: string; // defaults to '.camo-legend.json'
  };
}

const DEFAULT_FORMAT = 'assets/[codename]-[hash][extname]';
const DEFAULT_INCLUDE = ['js', 'css'];
const DEFAULT_LEGEND_PATH = '.camo-legend.json';

export function tyroCamo(options: TyroCamoOptions = {}): Plugin {
  const resolver = new CodenameResolver(options.words);
  const aliases = Object.fromEntries(
    Object.entries(options.aliases ?? {}).map(([source, codename]) => [normalizePath(source), codename]),
  );
  const bypassed = new Map<string, string>();

  const legendPath = options.legend?.path ?? DEFAULT_LEGEND_PATH;
  const legendEnabled = options.legend?.enabled ?? Boolean(options.legend?.path);

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

    configResolved(config) {
      wrapper.root = config.root;
      wrapper.assetsDir = config.build.assetsDir || 'assets';
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

export { CodenameResolver, normalizePath } from './dictionary';
export { BYPASS_MARKERS, wrapOutput } from './wrapper';
export type { Strategy, WrapperOptions } from './wrapper';
export default tyroCamo;
