import { build } from 'vite';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { tyroCamo } from '../src/index';

/**
 * Real `vite.build()` coverage for Blade entry injection.
 *
 * laravel-vite-plugin forwards the user's `input` option verbatim, so the documented Laravel
 * shape is an ARRAY of relative strings. These tests exercise every input shape because the
 * array branch behaves differently from the object branch when entries are appended.
 *
 * The fixture lives inside the repository: Vite derives manifest keys from the real path, so a
 * symlinked root (macOS `/var` -> `/private/var` in `os.tmpdir()`) would mangle every key.
 */
describe('blade entry injection', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '.tmp/blade-input-fixture');
  const cwd = process.cwd();

  afterAll(() => {
    process.chdir(cwd);
    // Only this suite's fixture: `tests/.tmp` is shared with the other integration suite.
    rmSync(root, { recursive: true, force: true });
  });

  const write = (path: string, contents: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };

  /** Builds from inside the project root, the way a real Laravel `npm run build` does. */
  const runBuild = async (options: {
    input: unknown;
    outDir: string;
    output?: Record<string, unknown>;
    camo?: Parameters<typeof tyroCamo>[0];
  }) => {
    process.chdir(root);
    try {
      await build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [tyroCamo(options.camo ?? {})],
        build: {
          outDir: options.outDir,
          emptyOutDir: true,
          manifest: true,
          minify: false,
          rollupOptions: { input: options.input as any, output: options.output },
        },
      });
    } finally {
      process.chdir(cwd);
    }

    const outDir = join(root, options.outDir);
    return {
      manifest: JSON.parse(readFileSync(join(outDir, '.vite/manifest.json'), 'utf8')),
      assets: readdirSync(join(outDir, 'assets')),
    };
  };

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, 'resources/js'), { recursive: true });
    mkdirSync(join(root, 'resources/views'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, type: 'module' }));
    write('resources/js/app.js', 'console.log("app");\n');
    write('resources/js/hasin.js', 'console.log("hasin");\n');
    write('resources/views/welcome.blade.php', "@vite(['resources/js/app.js'])\n@vite('resources/js/hasin.js')\n");
  });

  it('builds discovered entries and preserves manifest keys', async () => {
    const { manifest } = await runBuild({
      input: { 'resources/js/app.js': join(root, 'resources/js/app.js') },
      outDir: 'public/build',
      camo: { legend: { enabled: true } },
    });

    expect(Object.keys(manifest).sort()).toEqual(['resources/js/app.js', 'resources/js/hasin.js']);
    const file = manifest['resources/js/hasin.js'].file as string;
    expect(file).toMatch(/^assets\/[a-z0-9-]+-[A-Za-z0-9_-]+\.js$/);
    expect(existsSync(join(root, 'public/build', file))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, '.camo-legend.json'), 'utf8'))['resources/js/hasin.js']).toMatch(/^[a-z0-9-]+$/);
  });

  it('appends to an array input without changing Rollup [name] semantics', async () => {
    // `preserve` leaves the pattern alone, so this exposes what `[name]` resolves to.
    const { manifest, assets } = await runBuild({
      input: ['resources/js/app.js'],
      outDir: 'out-array',
      output: { entryFileNames: 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
      camo: { unmappedStrategy: 'preserve' },
    });

    expect(Object.keys(manifest).sort()).toEqual(['resources/js/app.js', 'resources/js/hasin.js']);
    // Rollup must still see the basename, not the full relative key.
    expect(assets.some((file) => /^app-[A-Za-z0-9_-]+\.js$/.test(file))).toBe(true);
    expect(assets.some((file) => file.includes('resources/js'))).toBe(false);
  });

  it('keeps entries that differ only by extension when input is an array', async () => {
    write('resources/js/theme.js', 'console.log("js");\n');
    write('resources/js/theme.mjs', 'console.log("mjs");\n');
    write('resources/views/welcome.blade.php', "@vite('resources/js/app.js')\n");

    const { manifest } = await runBuild({
      input: [join(root, 'resources/js/theme.js'), join(root, 'resources/js/theme.mjs')],
      outDir: 'out-ext',
    });

    // Regression: extension-stripped object keys collapsed these into one entry.
    expect(Object.keys(manifest).sort()).toEqual([
      'resources/js/app.js',
      'resources/js/theme.js',
      'resources/js/theme.mjs',
    ]);
  });

  it('does not build a source twice when input already lists it under a custom key', async () => {
    // The only referenced entry is the one already present in `input`.
    write('resources/views/welcome.blade.php', "@vite('resources/js/hasin.js')\n");

    const { assets, manifest } = await runBuild({
      // Custom key with an absolute value, which the previous dedup failed to recognise.
      input: { main: join(root, 'resources/js/hasin.js') },
      outDir: 'out-dupe',
    });

    const javascript = assets.filter((file) => file.endsWith('.js'));
    expect(javascript).toHaveLength(1);
    expect(Object.keys(manifest)).toEqual(['resources/js/hasin.js']);
  });

  it('never injects a build directory referenced by @vite(entries, buildDirectory)', async () => {
    // A previous build leaves this directory on disk, so an `existsSync` check would accept it.
    mkdirSync(join(root, 'public/build'), { recursive: true });
    writeFileSync(join(root, 'public/build/manifest.json'), '{}');
    write('resources/views/welcome.blade.php', "@vite(['resources/js/app.js'], 'public/build')\n");

    const { manifest } = await runBuild({
      input: { 'resources/js/app.js': join(root, 'resources/js/app.js') },
      outDir: 'out-builddir',
    });

    expect(Object.keys(manifest)).toEqual(['resources/js/app.js']);
    expect(Object.keys(manifest)).not.toContain('public/build');
  });

  it('can be disabled', async () => {
    const { manifest } = await runBuild({
      input: { 'resources/js/app.js': join(root, 'resources/js/app.js') },
      outDir: 'out-disabled',
      camo: { discover: { enabled: false } },
    });

    expect(Object.keys(manifest)).toEqual(['resources/js/app.js']);
  });

  it('supports custom discovery directories', async () => {
    write('resources/views/welcome.blade.php', "@vite('resources/js/app.js')\n");
    write('app/View/custom.blade.php', "@vite('resources/js/hasin.js')\n");

    const { manifest } = await runBuild({
      input: { 'resources/js/app.js': join(root, 'resources/js/app.js') },
      outDir: 'out-custom-dirs',
      camo: { discover: { dirs: ['app/View'] } },
    });

    expect(Object.keys(manifest).sort()).toEqual(['resources/js/app.js', 'resources/js/hasin.js']);
  });
});
