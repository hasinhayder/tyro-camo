import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { discoverViteEntries, extractViteEntries } from '../src/discover';

describe('Blade discovery', () => {
  it('extracts single and array entries while ignoring non-static/external values', () => {
    expect(extractViteEntries("@vite('resources/js/app.js') @vite(['resources/css/app.css', 'resources/js/hasin.js']) @vite($x) @vite('https://cdn.example/app.js')")).toEqual(['resources/js/app.js', 'resources/css/app.css', 'resources/js/hasin.js']);
  });

  describe('directive arguments', () => {
    it('never treats the build directory of a single-string directive as an entry', () => {
      expect(extractViteEntries("@vite('resources/js/app.js', 'build')")).toEqual(['resources/js/app.js']);
      expect(extractViteEntries("@vite('resources/js/app.js', 'public/build')")).toEqual(['resources/js/app.js']);
    });

    it('never treats the build directory of an array directive as an entry', () => {
      // Regression: the build directory was collected as a second entry, and because
      // `public/build` exists after any previous build it was injected as an input, failing the build.
      expect(extractViteEntries("@vite(['resources/js/app.js'], 'public/build')")).toEqual(['resources/js/app.js']);
      expect(extractViteEntries("@vite(['resources/css/app.css', 'resources/js/app.js'], 'build')")).toEqual([
        'resources/css/app.css',
        'resources/js/app.js',
      ]);
    });

    it('ignores commented-out directives', () => {
      expect(extractViteEntries("{{-- @vite('resources/js/removed.js') --}}")).toEqual([]);
      expect(extractViteEntries("{{-- @vite(['resources/js/removed.js']) --}}\n@vite('resources/js/app.js')")).toEqual(['resources/js/app.js']);
    });

    it('ignores php calls nested in the entry array', () => {
      expect(extractViteEntries("@vite(['resources/js/app.js', config('app.name')])")).toEqual(['resources/js/app.js']);
    });

    it('handles parentheses and nested brackets in the argument list', () => {
      expect(extractViteEntries("@vite(['resources/js/app.js'], config('vite.build'))")).toEqual(['resources/js/app.js']);
      expect(extractViteEntries("@vite('resources/js/app.js') @vite('resources/js/other.js')")).toEqual([
        'resources/js/app.js',
        'resources/js/other.js',
      ]);
    });

    it('accepts a bare filename with a known extension but not arbitrary literals', () => {
      expect(extractViteEntries("@vite('app.js')")).toEqual(['app.js']);
      expect(extractViteEntries("@vite('not-an-entry')")).toEqual([]);
    });

    it('skips external urls and variable arguments', () => {
      const blade = "@vite('https://cdn.example.com/app.js')\n@vite($entries)\n@vite('//cdn.example.com/app.css')";
      expect(extractViteEntries(blade)).toEqual([]);
    });

    it('normalizes leading slashes and ./ prefixes', () => {
      expect(extractViteEntries('@vite("/resources/js/app.js")')).toEqual(['resources/js/app.js']);
      expect(extractViteEntries("@vite('./resources/js/app.js')")).toEqual(['resources/js/app.js']);
    });
  });

  describe('filesystem walking', () => {
    const root = mkdtempSync(join(tmpdir(), 'tyro-camo-discover-'));

    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it('walks blade templates recursively and returns sorted unique entries', () => {
      mkdirSync(join(root, 'resources/views/dashboard'), { recursive: true });
      writeFileSync(join(root, 'resources/views/dashboard/mail-users.blade.php'), "@vite(['resources/js/mail.js'])");
      writeFileSync(join(root, 'resources/views/welcome.blade.php'), "@vite('resources/js/hasin.js') @vite('resources/js/hasin.js')");
      writeFileSync(join(root, 'resources/views/ignored.txt'), "@vite('resources/js/ignored.js')");

      expect(discoverViteEntries(root)).toEqual(['resources/js/hasin.js', 'resources/js/mail.js']);
    });

    it('skips node_modules and vendor directories', () => {
      mkdirSync(join(root, 'node_modules/pkg'), { recursive: true });
      mkdirSync(join(root, 'vendor/lib'), { recursive: true });
      writeFileSync(join(root, 'node_modules/pkg/x.blade.php'), "@vite('resources/js/dep.js')");
      writeFileSync(join(root, 'vendor/lib/y.blade.php'), "@vite('resources/js/vendor.js')");

      const entries = discoverViteEntries(root);
      expect(entries).not.toContain('resources/js/dep.js');
      expect(entries).not.toContain('resources/js/vendor.js');
    });

    it('returns nothing for missing directories', () => {
      expect(discoverViteEntries(root, ['nope'])).toEqual([]);
    });

    it('supports custom directories', () => {
      mkdirSync(join(root, 'app/View'), { recursive: true });
      writeFileSync(join(root, 'app/View/custom.blade.php'), "@vite('resources/js/custom.js')");

      expect(discoverViteEntries(root, ['app/View'])).toEqual(['resources/js/custom.js']);
    });
  });
});
