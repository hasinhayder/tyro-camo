import { adjectives as defaultAdjectives, nouns as defaultNouns } from './words';

export function normalizePath(value: string): string {
  return value.split('?')[0].replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
}

function hashPath(value: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(normalizePath(value))) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface DictionaryOptions {
  adjectives?: string[];
  nouns?: string[];
}

export class CodenameResolver {
  readonly adjectives: string[];
  readonly nouns: string[];
  private readonly assigned = new Map<string, string>();
  private readonly used = new Map<string, string>();

  constructor(words: DictionaryOptions = {}) {
    this.adjectives = [...(words.adjectives?.length ? words.adjectives : defaultAdjectives)];
    this.nouns = [...(words.nouns?.length ? words.nouns : defaultNouns)];
    if (!this.adjectives.length || !this.nouns.length) throw new Error('Tyro Camo word lists cannot be empty.');
  }

  resolve(source: string, explicit?: string): string {
    const key = normalizePath(source);
    const existing = this.assigned.get(key);
    if (existing) return existing;

    const requested = explicit?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    if (requested) {
      const owner = this.used.get(requested);
      if (!owner || owner === key) {
        this.used.set(requested, key);
        this.assigned.set(key, requested);
        return requested;
      }
    }

    const total = this.adjectives.length * this.nouns.length;
    const offset = hashPath(requested ? `${key}:alias-collision` : key) % total;

    for (let probe = 0; probe < total; probe++) {
      const index = (offset + probe) % total;
      const candidate = `${this.adjectives[Math.floor(index / this.nouns.length)]}-${this.nouns[index % this.nouns.length]}`;
      const owner = this.used.get(candidate);
      if (!owner || owner === key) {
        this.used.set(candidate, key);
        this.assigned.set(key, candidate);
        return candidate;
      }
    }
    throw new Error(`Tyro Camo could not find a unique codename for ${key}.`);
  }

  entries(): Record<string, string> { return Object.fromEntries(this.assigned); }
}
