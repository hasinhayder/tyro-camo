# vite-plugin-tyro-camo

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

> **Compatibility:** Supports Vite `^5.0.0`, `^6.0.0`, `^7.0.0`, `^8.0.0`, and later (`vite: >=5.0.0`), Node `>=18.0.0`, and works seamlessly with `@laravel/vite-plugin`.

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

### Blade Entry Discovery

`laravel-vite-plugin` only builds the entries listed in its `input` option, and it never scans
Blade templates. When a template references an extra entry via `@vite('resources/js/hasin.js')`,
the build succeeds but Laravel throws `Unable to locate file in Vite manifest` at runtime.

During `vite build`, Tyro Camo recursively scans `resources/views` (configurable), appends every
missing `@vite()` entry to the Rollup inputs, and camouflages it like any other entry. Manifest
keys stay identical to the Blade references, so nothing in your templates changes.

How directives are read:

| Blade | Discovered entries |
| :--- | :--- |
| `@vite('resources/js/app.js')` | `resources/js/app.js` |
| `@vite(['resources/css/app.css', 'resources/js/app.js'])` | both |
| `@vite('resources/js/app.js', 'build')` | `resources/js/app.js` - the second argument is a build directory |
| `@vite($entries)` | none - PHP variables cannot be resolved statically |
| `@vite('https://cdn.example.com/app.js')` | none - external URLs bypass the manifest |
| `{{-- @vite('resources/js/old.js') --}}` | none - commented-out directives are ignored |

The existing `input` shape is preserved: arrays stay arrays, so Rollup's `[name]` keeps resolving
to the basename rather than the whole relative path. Referenced paths that do not exist (or that
point at a directory) are reported as warnings instead of failing the build. The dev server is
unaffected. Disable with `tyroCamo({ discover: { enabled: false } })`.

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

### How Targeting Works

- **Script extensions target JavaScript chunks.** Rollup emits JavaScript for every entry, shared
  chunk and dynamic import, so `app.js`, `shared.js` and an async `heavy.ts` are all renamed. A
  chunk's `name` carries no extension (`heavy`, not `heavy.ts`), which the plugin handles.
  `include: ['ts', 'css']` therefore works, and listing `ts` is equivalent to listing `js` - a
  `.ts` source is compiled to JavaScript *before* Rollup names its output:

  | Source | Camouflaged with `['js', 'ts', 'css']` |
  | :--- | :--- |
  | `resources/js/app.js` | yes |
  | `resources/js/app.ts`, `app.tsx`, `app.mjs`, `app.vue`, `app.svelte` | yes - compiled to a JS chunk |
  | `resources/css/app.css` | yes |
  | `resources/css/theme.scss` | no - preprocessor output keeps its own extension, so add `scss` |
  | `resources/fonts/font.woff2` | no - delegated to your handler |

  Omitting every script extension (e.g. `include: ['css']`) leaves all JavaScript untouched.
- **Assets are classified by their real extension.** Fonts (`.woff2`), images and other non-listed
  types immediately delegate to your own `assetFileNames` handler, so custom asset pipelines and
  CSS `url()` rewriting keep working.
- **Aliases match exactly.** `resources/js/player.js` never claims `resources/js/admin/player.js`.
  A partial or basename-only key never matches, so an alias cannot be stolen by an unrelated file.
- **Naming is stable across machines.** Source identities are always project-root-relative, and
  absolute paths outside the project root are never emitted into filenames.

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

## Security Model

Tyro Camo hides **filenames** from rendered HTML and browser devtools. Be precise about what that
does and does not cover:

- **What it protects:** the `<script src>`/`<link href>` URLs that Laravel's `@vite()` directive
  renders, and every emitted file in `public/build/assets/`. Nothing in those paths contains a
  source name.
- **What it does not protect:** `public/build/manifest.json`. Laravel resolves `@vite('resources/js/player.js')`
  by looking up that exact key, so the manifest must keep the source path (and Rollup's chunk `name`)
  intact. Because `public/` is served by your web server, `/build/manifest.json` maps every source to
  its camouflaged file unless you block it. If your threat model includes manifest access, deny that
  route at the web-server or framework level; no filename scheme can substitute for it.
- **The legend is a secret.** `.camo-legend.json` is the inverse mapping. Keep it outside public web
  roots, never commit it, and let CI read it only where needed.

Camouflaging raises the cost of casual inspection; it is not a substitute for keeping real secrets
out of client-side code.

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

---

## Development & Local Testing

For local development commands, testing workflows, and instructions on testing in local Laravel projects without publishing to NPM, see the **[Development Guide](development.md)**.

```bash
npm test          # Run Vitest test suite (unit + real Vite build integration)
npm run typecheck # Validate TypeScript types
npm run build     # Build ESM/CJS bundles to dist/
```

The integration suite performs real `vite.build()` runs and asserts that no emitted filename
contains a source basename, so naming regressions fail the build instead of shipping.

---

## License

MIT License. See [LICENSE](LICENSE).
