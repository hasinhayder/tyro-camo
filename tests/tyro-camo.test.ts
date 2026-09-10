import { describe, expect, it, afterEach, vi } from 'vitest';
import { rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CodenameResolver, normalizePath } from '../src/dictionary';
import { BYPASS_MARKERS, wrapOutput, type WrapperOptions } from '../src/wrapper';
import { tyroCamo } from '../src/index';
import { adjectives, nouns } from '../src/words';

const createOptions = (overrides: Partial<WrapperOptions> = {}): WrapperOptions => ({
  aliases: {},
  format: 'assets/[codename]-[hash][extname]',
  include: ['js', 'css'],
  unmappedStrategy: 'codename',
  resolver: new CodenameResolver(),
  root: process.cwd(),
  assetsDir: 'assets',
  ...overrides,
});

const chunk = (overrides: Record<string, unknown> = {}) => ({ type: 'chunk' as const, isEntry: false, ...overrides });
const asset = (overrides: Record<string, unknown> = {}) => ({ type: 'asset' as const, ...overrides });

/** Every codename the built-in dictionary can produce. */
const validCodenames = new Set(adjectives.flatMap((adjective) => nouns.map((noun) => `${adjective}-${noun}`)));

describe('dictionary', () => {
  it('normalizes leading slashes, dot segments, queries and Windows separators', () => {
    expect(normalizePath('/resources/js/player.js?v=1')).toBe('resources/js/player.js');
    expect(normalizePath('./resources/js/player.js')).toBe('resources/js/player.js');
    expect(normalizePath('resources\\js\\player.js')).toBe('resources/js/player.js');
  });

  it('resolves identical codenames for equivalent paths', () => {
    const resolver = new CodenameResolver();
    const expected = resolver.resolve('resources/js/player.js');
    expect(resolver.resolve('/resources/js/player.js?v=1')).toBe(expected);
    expect(resolver.resolve('./resources/js/player.js')).toBe(expected);
    expect(resolver.resolve('resources\\js\\player.js')).toBe(expected);
  });

  it('produces consistent codenames from freshly created resolvers', () => {
    const files = Array.from({ length: 60 }, (_, index) => `resources/js/module-${index}.js`);
    const first = files.map((file) => new CodenameResolver().resolve(file));
    const second = files.map((file) => new CodenameResolver().resolve(file));
    expect(second).toEqual(first);
  });

  it('assigns a distinct built-in codename to each of 60+ files, regardless of resolution order', () => {
    const files = Array.from({ length: 64 }, (_, index) => `resources/js/file-${index}.js`);
    const forward = files.map((file) => new CodenameResolver().resolve(file));

    expect(new Set(forward).size).toBe(files.length);
    forward.forEach((codename) => expect(validCodenames.has(codename)).toBe(true));

    const reversed = [...files].reverse();
    const backward = reversed.map((file) => new CodenameResolver().resolve(file)).reverse();
    expect(backward).toEqual(forward);
  });

  it('probes deterministically when the word list is smaller than the file count', () => {
    const resolver = new CodenameResolver({ adjectives: ['amber', 'arctic'], nouns: ['tiger', 'harbor'] });
    const names = ['a.js', 'b.js', 'c.js', 'd.js'].map((file) => resolver.resolve(file));
    expect(new Set(names).size).toBe(4);
    expect(() => resolver.resolve('e.js')).toThrow(/could not find a unique codename/);
  });

  it('grants an explicit alias to the first claimant and falls back deterministically for the rest', () => {
    const resolver = new CodenameResolver();
    expect(resolver.resolve('resources/js/player.js', 'swift-tiger')).toBe('swift-tiger');
    const fallback = resolver.resolve('resources/js/other.js', 'swift-tiger');
    expect(fallback).not.toBe('swift-tiger');
    expect(fallback).toMatch(/^[a-z]+-[a-z]+$/);
  });
});

describe('wrapper', () => {
  it('camouflages chunks whose name carries no extension', () => {
    const output = wrapOutput({}, createOptions()) as any;
    // Shared/async chunks reach Rollup with `facadeModuleId: null` and a bare name.
    const shared = output.chunkFileNames(chunk({ name: 'shared' }));
    const dynamic = output.chunkFileNames(chunk({ name: 'devtools-guard', facadeModuleId: `${process.cwd()}/resources/js/devtools-guard.js` }));

    expect(shared).toMatch(/^assets\/[a-z]+-[a-z]+-\[hash\]\.js$/);
    expect(dynamic).toMatch(/^assets\/[a-z]+-[a-z]+-\[hash\]\.js$/);
    expect(dynamic).not.toContain('devtools-guard');
  });

  it('derives the chunk extension from the pattern the user configured', () => {
    const output = wrapOutput({ chunkFileNames: 'assets/[name]-[hash].mjs' }, createOptions()) as any;
    expect(output.chunkFileNames(chunk({ name: 'vendor' }))).toMatch(/\.mjs$/);
  });

  it('matches aliases on the exact project-relative path only', () => {
    const options = createOptions({
      aliases: { 'resources/js/player.js': 'swift-tiger' },
      root: '/project',
    });
    const output = wrapOutput({}, options) as any;

    expect(output.entryFileNames(chunk({ isEntry: true, facadeModuleId: '/project/resources/js/player.js', name: 'resources/js/player.js' })))
      .toBe('assets/swift-tiger-[hash].js');
    // A same-named file elsewhere must not steal the alias.
    expect(output.entryFileNames(chunk({ isEntry: true, facadeModuleId: '/project/resources/js/admin/player.js', name: 'resources/js/admin/player.js' })))
      .not.toContain('swift-tiger');
  });

  it('resolves codenames for sources outside the project root without leaking absolute paths', () => {
    const options = createOptions({ root: '/project' });
    const output = wrapOutput({}, options) as any;
    const result = output.chunkFileNames(chunk({ name: 'vendor', moduleIds: ['/elsewhere/node_modules/vendor/index.js'] }));
    expect(result).toMatch(/^assets\/[a-z]+-[a-z]+-\[hash\]\.js$/);
  });

  it('supports unmappedStrategy "nameless" and records bypassed files', () => {
    const bypassed: [string, string][] = [];
    const options = createOptions({
      unmappedStrategy: 'nameless',
      onBypass: (source, strategy) => bypassed.push([source, strategy]),
      root: '/project',
    });
    const output = wrapOutput({}, options) as any;

    expect(output.entryFileNames(chunk({ isEntry: true, facadeModuleId: '/project/resources/js/app.js', name: 'resources/js/app.js' })))
      .toBe('assets/[hash].js');
    expect(output.assetFileNames(asset({ name: 'app.css' }))).toBe('assets/[hash][extname]');
    expect(bypassed).toContainEqual(['resources/js/app.js', 'nameless']);
  });

  it('supports unmappedStrategy "preserve" and still honours explicit aliases', () => {
    const options = createOptions({
      unmappedStrategy: 'preserve',
      aliases: { 'resources/js/player.js': 'swift-tiger' },
      root: '/project',
    });
    const output = wrapOutput({ entryFileNames: 'custom/[name].js' }, options) as any;

    expect(output.entryFileNames(chunk({ isEntry: true, facadeModuleId: '/project/resources/js/app.js', name: 'resources/js/app.js' })))
      .toBe('custom/[name].js');
    expect(output.entryFileNames(chunk({ isEntry: true, facadeModuleId: '/project/resources/js/player.js', name: 'resources/js/player.js' })))
      .toBe('assets/swift-tiger-[hash].js');
  });

  it('maps [extname] to the real extension for chunks and leaves assets to Rollup', () => {
    const output = wrapOutput({}, createOptions({ format: 'dist/[codename]-[hash][extname]' })) as any;
    expect(output.entryFileNames(chunk({ isEntry: true, facadeModuleId: `${process.cwd()}/resources/js/app.js` }))).toMatch(/^dist\/[a-z]+-[a-z]+-\[hash\]\.js$/);
    expect(output.assetFileNames(asset({ name: 'app.css' }))).toMatch(/^dist\/[a-z]+-[a-z]+-\[hash\]\[extname\]$/);
  });

  it('preserves user functions, output arrays, unrelated output options and non-code assets', () => {
    const original = (info: any) => `custom/${info.name}`;
    const manualChunks = { vendor: ['vue'] };
    const options = createOptions();

    const single = wrapOutput({ entryFileNames: original, assetFileNames: original, manualChunks, hoistTransitiveImports: true }, options) as any;
    expect(Array.isArray(single)).toBe(false);
    expect(single.manualChunks).toBe(manualChunks);
    expect(single.hoistTransitiveImports).toBe(true);
    expect(single.entryFileNames(chunk({ isEntry: true, facadeModuleId: `${process.cwd()}/resources/js/app.js` }))).toMatch(/^assets\//);
    expect(single.assetFileNames(asset({ name: 'font.woff2', originalFileName: 'resources/fonts/font.woff2' }))).toBe('custom/font.woff2');
    expect(single.assetFileNames(asset({ name: 'logo.svg', originalFileName: 'resources/img/logo.svg' }))).toBe('custom/logo.svg');

    const array = wrapOutput([{ entryFileNames: original }, { entryFileNames: original }], options) as any[];
    expect(array).toHaveLength(2);
    expect(array[0].entryFileNames(chunk({ isEntry: true, facadeModuleId: `${process.cwd()}/resources/js/app.js` }))).toMatch(/^assets\//);
  });

  it('falls back to the configured assets dir when the user set no pattern', () => {
    const output = wrapOutput({}, createOptions({ assetsDir: 'static', include: ['css'] })) as any;
    const logo = asset({ name: 'logo.svg', originalFileName: 'resources/img/logo.svg' });
    expect(output.assetFileNames(logo)).toBe('static/[name]-[hash][extname]');
    // `js` is not targeted here, so the chunk keeps the Vite-style fallback inside assetsDir.
    expect(output.entryFileNames(chunk({ isEntry: true, facadeModuleId: `${process.cwd()}/resources/js/app.js` }))).toBe('static/[name]-[hash].js');
  });
});

describe('plugin lifecycle and legend generation', () => {
  const legendPath = resolve(process.cwd(), '.test-camo-legend.json');

  afterEach(async () => {
    await rm(legendPath, { force: true });
  });

  /** Applies the `config` hook the way Vite does and returns the mutated config. */
  const applyConfig = (plugin: any, config: any = { build: { rollupOptions: {} } }) => {
    plugin.config(config);
    return config;
  };

  const context = () => ({ warn: vi.fn() }) as any;

  it('mutates the config in place so array outputs are never duplicated', () => {
    const plugin = tyroCamo();
    const config = applyConfig(plugin, {
      build: { rollupOptions: { output: [{ entryFileNames: 'a/[name].js' }, { entryFileNames: 'b/[name].js' }] } },
    });

    expect(config.build.rollupOptions.output).toHaveLength(2);
    expect(typeof config.build.rollupOptions.output[0].entryFileNames).toBe('function');
  });

  it('emits a legend covering every camouflaged source', async () => {
    const plugin = tyroCamo({
      aliases: { 'resources/js/player.js': 'swift-tiger' },
      legend: { enabled: true, path: '.test-camo-legend.json' },
    });

    const config = applyConfig(plugin);
    const entryFileNames = config.build.rollupOptions.output.entryFileNames;
    entryFileNames(chunk({ isEntry: true, facadeModuleId: `${process.cwd()}/resources/js/player.js`, name: 'resources/js/player.js' }));
    entryFileNames(chunk({ isEntry: true, facadeModuleId: `${process.cwd()}/resources/js/app.js`, name: 'resources/js/app.js' }));

    await (plugin.writeBundle as any).call(context(), {}, {});

    const legend = JSON.parse(await readFile(legendPath, 'utf8'));
    expect(legend['resources/js/player.js']).toBe('swift-tiger');
    expect(Object.keys(legend)).toHaveLength(2);
    expect(Object.keys(legend)).toEqual([...Object.keys(legend)].sort());
  });

  it('records bypassed files in the legend and warns about them', async () => {
    const plugin = tyroCamo({
      unmappedStrategy: 'nameless',
      legend: { enabled: true, path: '.test-camo-legend.json' },
    });

    const config = applyConfig(plugin);
    config.build.rollupOptions.output.entryFileNames(
      chunk({ isEntry: true, facadeModuleId: `${process.cwd()}/resources/js/app.js`, name: 'resources/js/app.js' }),
    );

    const ctx = context();
    await (plugin.writeBundle as any).call(ctx, {}, {});

    const legend = JSON.parse(await readFile(legendPath, 'utf8'));
    expect(legend['resources/js/app.js']).toBe(BYPASS_MARKERS.nameless);
    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining('resources/js/app.js'));
  });

  it('warns about bypassed files even when the legend is disabled', async () => {
    const plugin = tyroCamo({ unmappedStrategy: 'preserve' });
    const config = applyConfig(plugin);
    config.build.rollupOptions.output.entryFileNames(
      chunk({ isEntry: true, facadeModuleId: `${process.cwd()}/resources/js/app.js`, name: 'resources/js/app.js' }),
    );

    const ctx = context();
    await (plugin.writeBundle as any).call(ctx, {}, {});

    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining('not camouflaged'));
  });
});
