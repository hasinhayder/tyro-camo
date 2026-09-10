import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tyroCamo } from '../src/index';
import { adjectives, nouns } from '../src/words';

/**
 * End-to-end coverage against a real Rollup/Vite build. Mocked `PreRenderedChunk` objects hide
 * plugin bugs (a chunk's `name` has no extension, `facadeModuleId` is null for shared chunks),
 * so this suite builds an actual Laravel-shaped project and audits the emitted files.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '.tmp/camo-fixture');
const assetsDir = resolve(projectRoot, 'dist/assets');

const ALIASES = {
  'resources/js/player.js': 'swift-tiger',
  'resources/js/devtools-guard.js': 'iron-fog',
};

const validCodenames = new Set(adjectives.flatMap((adjective) => nouns.map((noun) => `${adjective}-${noun}`)));

const write = async (path: string, contents: string | Buffer) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
};

const runBuild = async (outDir: string, legendPath: string) => {
  await build({
    root: projectRoot,
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir,
      emptyOutDir: true,
      manifest: true,
      minify: false,
      rollupOptions: {
        input: {
          'resources/js/app.js': resolve(projectRoot, 'resources/js/app.js'),
          'resources/js/player.js': resolve(projectRoot, 'resources/js/player.js'),
          'resources/js/devtools-guard.js': resolve(projectRoot, 'resources/js/devtools-guard.js'),
          'resources/js/checks.ts': resolve(projectRoot, 'resources/js/checks.ts'),
          'resources/css/app.css': resolve(projectRoot, 'resources/css/app.css'),
        },
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          // A function pattern makes Vite issue its internal directory probe, which must not
          // register codenames. See the "phantom legend" regression test below.
          assetFileNames: () => 'assets/[name]-[hash][extname]',
        },
      },
    },
    plugins: [tyroCamo({ aliases: ALIASES, legend: { enabled: true, path: legendPath } })],
  });

  return {
    manifest: JSON.parse(await readFile(resolve(projectRoot, outDir, '.vite/manifest.json'), 'utf8')),
    files: (await readdir(resolve(projectRoot, outDir, 'assets'))).sort(),
    legend: JSON.parse(await readFile(resolve(projectRoot, legendPath), 'utf8')) as Record<string, string>,
  };
};

beforeAll(async () => {
  // Only this suite's fixture: `tests/.tmp` is shared with the Blade injection suite, which
  // runs in a parallel worker.
  await rm(projectRoot, { recursive: true, force: true });

  await write(resolve(projectRoot, 'package.json'), JSON.stringify({ name: 'camo-fixture', private: true, type: 'module' }));
  await write(resolve(projectRoot, 'resources/js/app.js'), [
    "import { greet } from './shared.js';",
    "import '../css/app.css';",
    "import('./heavy.js').then((module) => module.boom());",
    "console.log('app', greet('app'));",
  ].join('\n'));
  await write(resolve(projectRoot, 'resources/js/shared.js'), "export const greet = (who) => `hello ${who}`;\n");
  await write(resolve(projectRoot, 'resources/js/heavy.js'), "export const boom = () => 'boom';\n");
  await write(resolve(projectRoot, 'resources/js/player.js'), "import { greet } from './shared.js';\nconsole.log(greet('player'));\n");
  await write(resolve(projectRoot, 'resources/js/devtools-guard.js'), 'export const guard = true;\n');
  await write(resolve(projectRoot, 'resources/js/checks.ts'), [
    "import { greet } from './shared.js';",
    "import('./report.ts').then((module) => module.report());",
    "const who: string = 'ts';",
    'console.log(greet(who));',
  ].join('\n'));
  await write(resolve(projectRoot, 'resources/js/report.ts'), "export const report = (): string => 'report';\n");
  await write(resolve(projectRoot, 'resources/css/app.css'), "body { background: url('../fonts/demo.woff2'); }\n");
  // Larger than Vite's 4kb inline threshold, so it must be emitted as a real asset file.
  await write(resolve(projectRoot, 'resources/fonts/demo.woff2'), Buffer.concat([
    Buffer.from('774f46320000000000000000', 'hex'),
    Buffer.alloc(6000, 7),
  ]));
});

afterAll(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe('integration: real Vite build', () => {
  it('camouflages every emitted script and stylesheet without leaking source names', async () => {
    const { files, legend } = await runBuild('dist', '.camo-legend.json');

    const codeFiles = files.filter((file) => /\.(js|css)$/.test(file));
    expect(codeFiles.length).toBeGreaterThan(0);

    // Each emitted file must be claimed by exactly one legend codename, and vice versa.
    // A leaked file such as `heavy-bV3L3yLk.js` matches no codename and fails here.
    const unclaimed = codeFiles.filter((file) => !Object.values(legend).some((codename) => file.startsWith(`${codename}-`)));
    expect(unclaimed).toEqual([]);

    for (const codename of Object.values(legend)) {
      if (codename.startsWith('[')) continue;
      expect(validCodenames.has(codename) || Object.values(ALIASES).includes(codename)).toBe(true);
      expect(codeFiles.filter((file) => file.startsWith(`${codename}-`))).toHaveLength(1);
    }

    // The legend covers every camouflaged source and reports no bypasses for the default strategy.
    expect(legend['resources/js/player.js']).toBe('swift-tiger');
    expect(legend['resources/js/devtools-guard.js']).toBe('iron-fog');
    expect(Object.values(legend).some((value) => value.startsWith('['))).toBe(false);
  });

  it('camouflages TypeScript entries and their chunks with the default options', async () => {
    const { manifest, files, legend } = await runBuild('dist', '.camo-legend.json');

    // A `.ts` source is a JavaScript chunk by the time Rollup names it, so `ts` in the default
    // include list must target it rather than silently doing nothing.
    const entry = manifest['resources/js/checks.ts'].file as string;
    expect(entry).toMatch(/^assets\/[a-z]+-[a-z]+-[A-Za-z0-9_-]+\.js$/);
    expect(entry).not.toContain('checks');

    // A dynamically imported `.ts` chunk is camouflaged too.
    const dynamic = manifest['resources/js/report.ts'];
    expect(dynamic.isDynamicEntry).toBe(true);
    expect(dynamic.file).not.toContain('report');

    expect(legend['resources/js/checks.ts']).toMatch(/^[a-z]+-[a-z]+$/);
    expect(files.some((file) => file.includes('checks') || file.includes('report'))).toBe(false);
  });

  it('keeps alias, entry, shared chunk and dynamic chunk filenames free of source names', async () => {
    const { manifest, files } = await runBuild('dist', '.camo-legend.json');

    expect(manifest['resources/js/player.js'].file).toContain('swift-tiger-');
    expect(manifest['resources/js/devtools-guard.js'].file).toContain('iron-fog-');

    // Regression: shared and async chunks used to fall through to Vite's `[name]-[hash]` pattern.
    const dynamic = manifest['resources/js/heavy.js'];
    expect(dynamic.isDynamicEntry).toBe(true);
    expect(dynamic.file).not.toContain('heavy');

    const sourceNames = ['app', 'player', 'guard', 'shared', 'heavy', 'devtools'];
    const leaked = files.filter((file) => sourceNames.some((name) => file.toLowerCase().includes(name)));
    expect(leaked).toEqual([]);
  });

  it('delegates non-targeted assets such as fonts to the original handler', async () => {
    const { files } = await runBuild('dist', '.camo-legend.json');

    expect(files.some((file) => /^demo-[A-Za-z0-9_-]+\.woff2$/.test(file))).toBe(true);
    expect(files.some((file) => file.endsWith('.woff2') && file.includes('iron'))).toBe(false);
  });

  it('produces identical filenames on a rebuild', async () => {
    const first = await runBuild('dist', '.camo-legend.json');
    await rm(resolve(projectRoot, 'dist'), { recursive: true, force: true });
    const second = await runBuild('dist', '.camo-legend.json');

    expect(second.files).toEqual(first.files);
    expect(second.manifest).toEqual(first.manifest);
    expect(second.legend).toEqual(first.legend);
  });

  it('records no phantom legend entries for Vite internal asset probes', async () => {
    // With an ARRAY input (the shape laravel-vite-plugin produces) Vite's internal directory
    // probe passes a bare basename such as `app.css`, which must not be mistaken for a real
    // asset - doing so consumes a codename and adds a legend entry for a file never emitted.
    const outDir = 'dist-probe';
    const legendPath = '.camo-legend-probe.json';

    await build({
      root: projectRoot,
      configFile: false,
      logLevel: 'silent',
      build: {
        outDir,
        emptyOutDir: true,
        manifest: true,
        minify: false,
        rollupOptions: {
          input: [
            resolve(projectRoot, 'resources/css/app.css'),
            resolve(projectRoot, 'resources/js/player.js'),
          ],
          output: {
            entryFileNames: 'assets/[name]-[hash].js',
            chunkFileNames: 'assets/[name]-[hash].js',
            assetFileNames: () => 'assets/[name]-[hash][extname]',
          },
        },
      },
      plugins: [tyroCamo({ legend: { enabled: true, path: legendPath } })],
    });

    const legend = JSON.parse(await readFile(resolve(projectRoot, legendPath), 'utf8')) as Record<string, string>;
    const files = await readdir(resolve(projectRoot, outDir, 'assets'));

    expect(Object.keys(legend).sort()).toEqual(['resources/css/app.css', 'resources/js/player.js']);
    for (const [source, codename] of Object.entries(legend)) {
      expect(source).toMatch(/^resources\//);
      expect(files.some((file) => file.startsWith(`${codename}-`))).toBe(true);
    }
  });

  it('never duplicates a multi-output configuration', async () => {
    const outputs: any[] = [];
    await build({
      root: projectRoot,
      configFile: false,
      logLevel: 'silent',
      build: {
        outDir: 'dist-multi',
        emptyOutDir: true,
        minify: false,
        rollupOptions: {
          input: { 'resources/js/app.js': resolve(projectRoot, 'resources/js/app.js') },
          output: [
            { dir: resolve(projectRoot, 'dist-multi/a'), format: 'es', entryFileNames: 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
            { dir: resolve(projectRoot, 'dist-multi/b'), format: 'es', entryFileNames: 'assets/[name]-[hash].js', chunkFileNames: 'assets/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
          ],
        },
      },
      plugins: [
        {
          name: 'capture-outputs',
          configResolved(config) {
            outputs.push(...(Array.isArray(config.build.rollupOptions.output)
              ? config.build.rollupOptions.output
              : [config.build.rollupOptions.output]));
          },
        },
        tyroCamo(),
      ],
    });

    expect(outputs).toHaveLength(2);
    outputs.forEach((output) => expect(typeof output.entryFileNames).toBe('function'));
  });
});
