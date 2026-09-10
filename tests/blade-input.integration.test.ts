import { build } from 'vite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tyroCamo } from '../src/index';

describe('blade entry injection', () => {
  const root = mkdtempSync(join(process.cwd(), '.tyro-camo-input-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it('builds discovered entries and preserves manifest keys', async () => {
    mkdirSync(join(root, 'resources/js'), { recursive: true });
    mkdirSync(join(root, 'resources/views'), { recursive: true });
    writeFileSync(join(root, 'resources/js/app.js'), 'console.log("app");');
    writeFileSync(join(root, 'resources/js/hasin.js'), 'console.log("hasin");');
    writeFileSync(join(root, 'resources/views/welcome.blade.php'), "@vite('resources/js/app.js')\n@vite('resources/js/hasin.js')");
    await build({ root, configFile: false, logLevel: 'silent', plugins: [tyroCamo({ legend: { enabled: true } })], build: { outDir: 'public/build', manifest: 'manifest.json', rollupOptions: { input: { 'resources/js/app.js': join(root, 'resources/js/app.js') } } } });
    const manifest = JSON.parse(readFileSync(join(root, 'public/build/manifest.json'), 'utf8'));
    expect(Object.keys(manifest).sort()).toEqual(['resources/js/app.js', 'resources/js/hasin.js']);
    const file = manifest['resources/js/hasin.js'].file as string;
    expect(file).toMatch(/^assets\/[a-z0-9-]+-[A-Za-z0-9_-]+\.js$/);
    expect(existsSync(join(root, 'public/build', file))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, '.camo-legend.json'), 'utf8'))['resources/js/hasin.js']).toMatch(/^[a-z0-9-]+$/);
  });
});
