# vite-plugin-tyro-camo

Stealth asset camouflage for Laravel & Vite. Cloak and camouflage compiled frontend JavaScript and CSS bundles under symbolic, human-friendly, inoffensive codenames while keeping Vite's `manifest.json` completely intact — **no changes are needed in Blade templates or source files**.

---

## The Problem

In Laravel applications using Vite, compiled frontend assets reveal their purpose through their filenames in production (e.g. `player.js`, `devtools-guard.js`, `license-check.js`, `checkout.js`). Even with hash suffixes (`player-C9x0a.js`), the source filename is exposed in the public HTML and browser devtools.

Laravel resolves compiled assets via `public/build/manifest.json`. When Blade templates use `@vite('resources/js/player.js')`, Laravel simply inspects the manifest to locate the target bundle path.

**Tyro Camo** automatically cloaks compiled JavaScript and CSS assets under symbolic, deterministic code names (e.g. `swift-tiger-[hash].js`, `amber-harbor-[hash].js`, `deep-lagoon-[hash].css`) without breaking Laravel's asset manifest keys.

---

## Installation

```bash
npm install vite-plugin-tyro-camo --save-dev
```

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

  // Strategy for chunks not listed in aliases: 'codename' | 'nameless' | 'preserve'
  unmappedStrategy: 'codename',

  // Extensions to camouflage (defaults to ['js', 'css'])
  include: ['js', 'css'],

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
| `unmappedStrategy` | `'codename' \| 'nameless' \| 'preserve'` | `'codename'` | Strategy for targeted files without explicit aliases. |
| `include` | `string[]` | `['js', 'css']` | File extensions targeted for camouflaging. |
| `words.adjectives` | `string[]` | Built-in (62 words) | Custom adjective list; replaces the built-in list. |
| `words.nouns` | `string[]` | Built-in (71 words) | Custom noun list; replaces the built-in list. |
| `legend.enabled` | `boolean` | `false` (or `true` when `legend.path` is set) | When true, exports a secret source-to-codename JSON legend. |
| `legend.path` | `string` | `'.camo-legend.json'` | Path (relative to root) to write the legend JSON. |

### How Targeting Works

- **Chunks are always camouflaged when `js` is in `include`.** Rollup emits JavaScript for every
  entry, shared chunk and dynamic import, so `app.js`, `shared.js` and an async `heavy.js` are all
  renamed. A chunk's `name` carries no extension (`heavy`, not `heavy.js`), which the plugin handles.
- **Assets are classified by their real extension.** Fonts (`.woff2`), images and other non-listed
  types immediately delegate to your own `assetFileNames` handler, so custom asset pipelines and
  CSS `url()` rewriting keep working.
- **Aliases match exactly.** `resources/js/player.js` never claims `resources/js/admin/player.js`.
  A partial or basename-only key never matches, so an alias cannot be stolen by an unrelated file.
- **Naming is stable across machines.** Source identities are always project-root-relative, and
  absolute paths outside the project root are never emitted into filenames.

### Legend Format

The legend maps every source to the codename it received. Files deliberately left un-camouflaged by
`unmappedStrategy: 'nameless' | 'preserve'` are recorded with a bracketed marker, so an audit can
never mistake a leaked name for a camouflaged one:

```json
{
  "resources/css/app.css": "hidden-cove",
  "resources/js/player.js": "swift-tiger",
  "resources/js/devtools-guard.js": "[preserve]"
}
```

> [!WARNING]
> The legend is a **secret** and reveals every mapping. Keep it outside public web roots and add it to
> `.gitignore`. The plugin logs a warning with the resolved absolute path whenever it writes one.

---

### Strategy Trade-offs

| `unmappedStrategy` | Un-aliased entries/chunks | Leaks source name? |
| :--- | :--- | :--- |
| `'codename'` (default) | `assets/amber-harbor-[hash].js` | No |
| `'nameless'` | `assets/[hash].js` | No (loses readability) |
| `'preserve'` | Your own pattern, e.g. `assets/[name]-[hash].js` | **Yes** - `[name]` resolves to the relative source path for entries, producing `assets/resources/js/app.js-[hash].js` |

> [!CAUTION]
> `'preserve'` is an escape hatch, not a privacy mode. For entries, Rollup's `[name]` is the
> project-relative source path, so `preserve` can expose *more* than Vite's default naming. Use it
> only when another tool owns your filenames, and expect those files in the legend as `"[preserve]"`.

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

