/**
 * Per-wave-config high score storage.
 *
 * The wave parameters that affect gameplay are hashed into a stable key.
 * Cosmetic/sampling fields (gridRes, planeOffset, spawnX/Y, timeScale) are
 * deliberately excluded — they don't change how the wave plays.
 */

import type { WaveParams } from '../types';

const STORAGE_KEY = 'esurf-highscores-v1';

/** Subset of WaveParams keys that affect gameplay. */
const GAMEPLAY_KEYS: (keyof WaveParams)[] = [
  'wave1Mode', 'wave1Direction',
  'amplitude', 'wavelength', 'speedFactor',
  'wave2Enabled', 'wave2Mode', 'wave2Direction',
  'wave2OriginX', 'wave2OriginY',
  'wave2Amplitude', 'wave2Wavelength', 'wave2SpeedFactor',
  'wallEnabled', 'wallReflection',
  'gridExtent',
];

/** Round a number to a fixed number of decimals — stabilizes the hash key. */
function round(v: number, decimals: number): number {
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}

/** Build a deterministic key from gameplay-affecting params. */
export function waveKey(p: WaveParams): string {
  const parts: string[] = [];
  for (const k of GAMEPLAY_KEYS) {
    const v = p[k];
    if (typeof v === 'number') parts.push(`${k}:${round(v, 2)}`);
    else parts.push(`${k}:${String(v)}`);
  }
  return parts.join('|');
}

type ScoreTable = Record<string, number>;

function read(): ScoreTable {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ScoreTable;
  } catch {
    return {};
  }
}

function write(table: ScoreTable): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(table)); } catch { /* ignore */ }
}

/** Return the high score for the given wave config (0 if none). */
export function getHighScore(p: WaveParams): number {
  return read()[waveKey(p)] ?? 0;
}

/**
 * Record a new score for this wave config. Returns true if it's a new best.
 */
export function submitScore(p: WaveParams, score: number): boolean {
  const table = read();
  const key = waveKey(p);
  const prev = table[key] ?? 0;
  if (score <= prev) return false;
  table[key] = Math.round(score);
  write(table);
  return true;
}
