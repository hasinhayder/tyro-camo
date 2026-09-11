# vite-plugin-tyro-camo

[![Tests](https://github.com/hasinhayder/tyro-camo/actions/workflows/tests.yml/badge.svg)](https://github.com/hasinhayder/tyro-camo/actions/workflows/tests.yml)
[![npm version](https://img.shields.io/npm/v/vite-plugin-tyro-camo.svg?style=flat-square)](https://www.npmjs.com/package/vite-plugin-tyro-camo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

Stealth asset camouflage for Laravel & Vite. Cloak and camouflage compiled frontend JavaScript and CSS bundles under symbolic, human-friendly, inoffensive codenames while keeping Vite's `manifest.json` completely intact — **no changes are needed in Blade templates or source files**.

---

## What Problem Does This Solve?

Imagine you build a Laravel website with special features—such as a video player for paying subscribers, a license verification script, an anti-tamper guard, or a proprietary algorithm.

When you run `npm run build`, Vite bundles your files and puts them in your public folder. In your webpage HTML, anyone can right-click and view page source to see:

```html
<!-- Without Tyro Camo: Source names are given away to anyone inspecting the page -->
<script src="/build/assets/video-player-C9x0a.js"></script>
<script src="/build/assets/anti-tamper-guard-D4m2k.js"></script>
<script src="/build/assets/license-validator-E7p9z.js"></script>
```

Even though Vite adds random hashes (`-C9x0a.js`), the **original filename is still in plain sight**. This creates two problems:
1. **It's a roadmap for bad actors:** Anyone can see exactly which script handles your DRM, video playback, or security checks, making it trivial to block them with ad-blockers (like uBlock Origin) or tamper with them in browser DevTools.
2. **Obvious obfuscation looks suspicious:** If you manually rename files to random gibberish like `x839fa.js`, it triggers security heuristics and ad-blockers because it *looks* like malicious code.

### The Laravel Dilemma
Why can't you just rename the files in your project? Because Laravel relies on `manifest.json`. If you change filenames, Laravel's `@vite('resources/js/video-player.js')` helper will crash with:
> `Unable to locate file in Vite manifest: resources/js/video-player.js`

### How Tyro Camo Fixes It
**Tyro Camo acts like a stealth cloaking device for your assets.**

It automatically disguises sensitive bundle filenames under innocent, human-friendly codenames (like nature, colors, and animals) **without changing a single line of your Laravel or Blade code**:

```html
<!-- With Tyro Camo: Innocent, natural-looking codenames that blend in -->
<script src="/build/assets/swift-tiger-C9x0a.js"></script>
<script src="/build/assets/deep-lagoon-D4m2k.js"></script>
<script src="/build/assets/amber-beacon-E7p9z.js"></script>
```

- ✅ **Your Blade templates stay 100% normal:** You still write `@vite('resources/js/video-player.js')`.
- ✅ **Laravel stays 100% happy:** `manifest.json` keeps the original keys mapped correctly.
- ✅ **Browsers & ad-blockers see ordinary names:** The bundles look like ordinary, harmless third-party libraries.
- ✅ **Completely automated:** Drop it into `vite.config.js` and you're done.

---

## Installation

```bash
npm install vite-plugin-tyro-camo --save-dev
```

> **Requirements:** Vite `>= 5.0.0` • Node.js `>= 18.0.0` • Works seamlessly with `laravel-vite-plugin`.

---

## Basic Setup

Add `tyroCamo()` to your `vite.config.js`:

```javascript
import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import { tyroCamo } from 'vite-plugin-tyro-camo';

export default defineConfig({
  plugins: [
    laravel({
      input: [
        'resources/css/app.css',
        'resources/js/app.js',
        'resources/js/player.js',
      ],
      refresh: true,
    }),
    tyroCamo(),
  ],
});
```

Laravel still references `resources/js/player.js` in `manifest.json`, so your Blade templates remain **100% standard and unchanged**:

```blade
@vite('resources/js/player.js')
```

---

## Configuration Options

```typescript
tyroCamo({
  // Explicitly map sensitive files to custom fixed codenames.
  // Keys must be exact, project-root-relative source paths.
  aliases: {
    'resources/js/player.js': 'swift-tiger',
    'resources/js/devtools-guard.js': 'iron-fog',
  },

  // Output filename template (defaults to 'assets/[codename]-[hash][extname]')
  format: 'assets/[codename]-[hash][extname]',

  // Optional deterministic rotation seed. Change this to refresh generated codenames.
  seed: 'rotation-2026-09',

  // Strategy for chunks not listed in aliases: 'codename' | 'nameless'
  unmappedStrategy: 'codename',

  // Extensions to camouflage (defaults to ['js', 'ts', 'css'])
  include: ['js', 'ts', 'css'],

  // Custom word dictionaries to replace built-in lists
  words: {
    adjectives: ['amber', 'arctic', 'swift'],
    nouns: ['tiger', 'beacon', 'harbor'],
  },

  // Export a build mapping legend for auditing/CI
  legend: {
    enabled: true,
    path: '.camo-legend.json',
  },
});
```

### Options Reference

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `aliases` | `Record<string, string>` | `{}` | Exact project-root-relative source path to codename mappings. |
| `format` | `string` | `'assets/[codename]-[hash][extname]'` | Rollup output pattern with `[codename]`, `[hash]`, `[extname]`. |
| `seed` | `string` | `undefined` | Optional deterministic seed; changing it rotates generated codenames. |
| `unmappedStrategy` | `'codename' \| 'nameless'` | `'codename'` | Strategy for targeted files without explicit aliases (`'codename'` generates readable codenames; `'nameless'` uses pure hashes). |
| `include` | `string[]` | `['js', 'ts', 'css']` | Extensions to camouflage. Script extensions target JavaScript chunks; anything else targets emitted assets by their real extension. |
| `words.adjectives` | `string[]` | Built-in (62 words) | Custom adjective list; replaces the built-in list. |
| `words.nouns` | `string[]` | Built-in (71 words) | Custom noun list; replaces the built-in list. |
| `legend.enabled` | `boolean` | `false` (or `true` when `legend.path` is set) | When true, exports a secret source-to-codename JSON legend. |
| `legend.path` | `string` | `'.camo-legend.json'` | Path (relative to root) to write the legend JSON. |
| `discover.enabled` | `boolean` | `true` | Auto-register `@vite()` entries found in Blade templates as build inputs. |
| `discover.dirs` | `string[]` | `['resources/views']` | Directories (relative to project root) scanned for `*.blade.php` files. |
### Legend Format

The legend maps every source to the codename it received. Files bypassed with
`unmappedStrategy: 'nameless'` are recorded with a `"[nameless]"` marker, so an audit can
never mistake a bypassed name for a camouflaged one:

```json
{
  "resources/css/app.css": "hidden-cove",
  "resources/js/player.js": "swift-tiger",
  "resources/js/devtools-guard.js": "[nameless]"
}
```

> [!WARNING]
> The legend is a **secret** and reveals every mapping. Keep it outside public web roots and add it to
> `.gitignore`. The plugin logs a warning with the resolved absolute path whenever it writes one.

---

### Strategy Trade-offs

| `unmappedStrategy` | Emitted bundle naming | Description |
| :--- | :--- | :--- |
| `'codename'` (default) | `assets/amber-harbor-[hash].js` | Disguises un-aliased files under natural, friendly codenames. |
| `'nameless'` | `assets/[hash].js` | Emits pure content hashes with no name prefix. |

---

## Features

- **Non-Destructive Rollup Wrapping:** Preserves custom user functions, output arrays (multi-output
  configs are never duplicated), and unrelated output options such as `manualChunks`.
- **Complete Codename Coverage:** Entries, shared chunks, dynamic imports and CSS are all renamed -
  no bundle keeps its source filename.
- **Target Filtering:** Non-code assets (e.g. fonts like `.woff2`, SVGs, images) immediately bypass
  cloaking and delegate to existing asset handlers.
- **Deterministic & Collision-Free:** Uses FNV-1a path hashing and collision probe offsets so
  rebuilds produce stable, reproducible bundle names.
- **Inoffensive Dictionary:** Curated nature, wildlife, geography, and elemental themes with zero
  slang or controversial terms, and no word repeated across both lists (4,402 combinations).
- **Auditable:** An optional legend records every mapping, including files that were deliberately
  left un-camouflaged.

## License

MIT License. See [LICENSE](LICENSE).
