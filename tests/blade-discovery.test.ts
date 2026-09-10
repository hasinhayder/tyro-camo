import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { discoverViteEntries, extractViteEntries } from '../src/discover';

describe('Blade discovery', () => {
  it('extracts single and array entries while ignoring non-static/external values', () => {
    expect(extractViteEntries("@vite('resources/js/app.js') @vite(['resources/css/app.css', 'resources/js/hasin.js']) @vite($x) @vite('https://cdn.example/app.js')")).toEqual(['resources/js/app.js', 'resources/css/app.css', 'resources/js/hasin.js']);
  });

  const root = mkdtempSync(join(tmpdir(), 'tyro-camo-discover-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it('walks recursively and deduplicates entries', () => {
    mkdirSync(join(root, 'resources/views/nested'), { recursive: true });
    writeFileSync(join(root, 'resources/views/welcome.blade.php'), "@vite('resources/js/hasin.js')");
    writeFileSync(join(root, 'resources/views/nested/mail.blade.php'), "@vite(['resources/js/hasin.js', 'resources/js/mail.js'])");
    expect(discoverViteEntries(root)).toEqual(['resources/js/hasin.js', 'resources/js/mail.js']);
  });
});
