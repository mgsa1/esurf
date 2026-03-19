/**
 * Visualizer control panel — sliders for trochoidal wave params.
 *
 * Each param row has three interactive elements:
 *   label (80px) | range slider (flex) | number input (56px)
 *
 * The range slider and number input are kept in sync bidirectionally:
 *   - Dragging the slider → number input updates instantly
 *   - Typing in the number input → slider moves in real-time on each keystroke
 *   - Blur / Enter on the number input → value is clamped to [min, max] and committed
 *
 * 50ms debounce applied when gridRes > 120 (expensive surface recompute).
 */

import type { WaveParams } from '../types';
import { PRESETS } from '../presets';

type SliderConfig = {
  key: keyof WaveParams;
  label: string;
  min: number;
  max: number;
  step: number;
  desc: string;
};

const GROUPS: Array<{ label: string; sliders: SliderConfig[] }> = [
  {
    label: 'WAVE',
    sliders: [
      { key: 'amplitude',   label: 'amplitude',   min: 0.5,  max: 8,   step: 0.05, desc: 'crest height above still water (0.5–8)' },
      { key: 'wavelength',  label: 'wavelength',  min: 5,    max: 60,  step: 0.5,  desc: 'spatial period in world units (5–60)' },
      { key: 'speedFactor', label: 'speedFactor', min: 0.1,  max: 3,   step: 0.05, desc: 'wave speed multiplier (0.1–3)' },
      { key: 'planeOffset', label: 'planeOffset', min: 0,    max: 30,  step: 0.5,  desc: 'game plane distance from origin (0–30)' },
    ],
  },
  {
    label: 'SAMPLING',
    sliders: [
      { key: 'gridRes',    label: 'gridRes',    min: 40,  max: 200, step: 10,  desc: '3D grid resolution per axis (40–200)' },
      { key: 'gridExtent', label: 'gridExtent', min: 10,  max: 50,  step: 1,   desc: '3D grid half-width in world units (10–50)' },
    ],
  },
];

// Wave 2 sliders (numeric only — the boolean toggle is handled separately)
const WAVE2_SLIDERS: SliderConfig[] = [
  { key: 'wave2OriginX',    label: 'origin X',   min: -50, max: 50,  step: 0.5,  desc: 'X coordinate of wave 2 center (-50–50)' },
  { key: 'wave2OriginY',    label: 'origin Y',   min: -50, max: 50,  step: 0.5,  desc: 'Y coordinate of wave 2 center (-50–50)' },
  { key: 'wave2Amplitude',  label: 'amplitude',  min: 0,   max: 8,   step: 0.05, desc: 'crest height of wave 2 (0–8)' },
  { key: 'wave2Wavelength', label: 'wavelength', min: 5,   max: 60,  step: 0.5,  desc: 'spatial period of wave 2 (5–60)' },
  { key: 'wave2SpeedFactor',label: 'speedFactor',min: 0.1, max: 3,   step: 0.05, desc: 'speed multiplier of wave 2 (0.1–3)' },
];

// Preset accent colors
const PRESET_COLORS: Record<string, { border: string; activeBg: string }> = {
  gentleSwell: { border: '#00FFCC', activeBg: 'rgba(0,255,204,0.15)' },
  surfBreak:   { border: '#FF6EB4', activeBg: 'rgba(255,110,180,0.15)' },
  stormWave:   { border: '#FFB800', activeBg: 'rgba(255,184,0,0.15)' },
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Inject a stylesheet once to hide browser number-input spinners. */
function ensureNumberInputStyles(): void {
  if (document.getElementById('esurf-num-style')) return;
  const style = document.createElement('style');
  style.id = 'esurf-num-style';
  style.textContent = `
    .esurf-num::-webkit-inner-spin-button,
    .esurf-num::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .esurf-num { -moz-appearance: textfield; }
  `;
  document.head.appendChild(style);
}

/** Format a numeric value for display inside a number input. */
function formatValue(v: number, key: keyof WaveParams): string {
  if (key === 'gridRes') return String(Math.round(v));
  if (key === 'wave2OriginX' || key === 'wave2OriginY') return v.toFixed(1);
  return v.toFixed(2);
}

/**
 * Build a label + range-slider + number-input row and wire them together.
 *
 * @param accentColor  - CSS color used for range accent and number-input focus border
 * @param getParamV    - reads the current param value (needed inside closures)
 * @param setParamV    - writes a new clamped value back to the live params object
 * @param onFire       - called after any committed change (may be debounced externally)
 */
function buildRow(
  cfg: SliderConfig,
  accentColor: string,
  getParamV: () => number,
  setParamV: (v: number) => void,
  onFire: () => void,
  debounceOnFire: () => void,
): { row: HTMLDivElement; rangeEl: HTMLInputElement; numEl: HTMLInputElement } {
  const { label, min, max, step, desc } = cfg;

  const row = document.createElement('div');
  row.style.cssText = `
    display: grid;
    grid-template-columns: 80px 1fr 56px;
    gap: 4px;
    align-items: center;
    margin-bottom: 6px;
  `;

  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.style.cssText = `
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: #C8C8E8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;

  // ---- Range slider ----
  const rangeEl = document.createElement('input');
  rangeEl.type = 'range';
  rangeEl.min = String(min);
  rangeEl.max = String(max);
  rangeEl.step = String(step);
  rangeEl.value = String(getParamV());
  rangeEl.setAttribute('aria-label', `${label}: ${desc}`);
  rangeEl.setAttribute('aria-valuemin', String(min));
  rangeEl.setAttribute('aria-valuemax', String(max));
  rangeEl.setAttribute('aria-valuenow', String(getParamV()));
  rangeEl.style.cssText = `width: 100%; accent-color: ${accentColor}; cursor: pointer;`;

  // ---- Number input ----
  const numEl = document.createElement('input');
  numEl.type = 'number';
  numEl.className = 'esurf-num';
  numEl.min = String(min);
  numEl.max = String(max);
  numEl.step = String(step);
  numEl.value = formatValue(getParamV(), cfg.key);
  numEl.style.cssText = `
    font-family: 'Courier New', monospace;
    font-size: 11px;
    color: #C8C8E8;
    background: transparent;
    border: none;
    border-bottom: 1px solid #2A2A4A;
    text-align: right;
    width: 100%;
    outline: none;
    padding: 1px 0;
  `;
  numEl.addEventListener('focus', () => { numEl.style.borderBottomColor = accentColor; });
  numEl.addEventListener('blur',  () => { numEl.style.borderBottomColor = '#2A2A4A'; });

  // ---- Slider → number input ----
  rangeEl.addEventListener('input', () => {
    const v = parseFloat(rangeEl.value);
    setParamV(v);
    rangeEl.setAttribute('aria-valuenow', String(v));
    numEl.value = formatValue(v, cfg.key);
    debounceOnFire();
  });

  // ---- Number input → slider (real-time while typing) ----
  numEl.addEventListener('input', () => {
    const raw = parseFloat(numEl.value);
    if (isNaN(raw)) return; // partial entry (e.g. "-" or ".") — wait
    const v = Math.min(max, Math.max(min, raw));
    setParamV(v);
    rangeEl.value = String(v);
    rangeEl.setAttribute('aria-valuenow', String(v));
    debounceOnFire();
  });

  // ---- Number input → commit on blur / Enter ----
  numEl.addEventListener('change', () => {
    const raw = parseFloat(numEl.value);
    const v = isNaN(raw) ? getParamV() : Math.min(max, Math.max(min, raw));
    setParamV(v);
    rangeEl.value = String(v);
    rangeEl.setAttribute('aria-valuenow', String(v));
    numEl.value = formatValue(v, cfg.key);
    onFire();
  });

  row.appendChild(labelEl);
  row.appendChild(rangeEl);
  row.appendChild(numEl);

  return { row, rangeEl, numEl };
}

/**
 * Initialize the control panel.
 * @param container — the #controls-panel element
 * @param initial   — starting WaveParams
 * @param onChange  — called whenever any param changes
 */
export function initControls(
  container: HTMLElement,
  initial: WaveParams,
  onChange: (p: WaveParams) => void
): void {
  ensureNumberInputStyles();

  let params: WaveParams = { ...initial };

  // Track all range inputs and number inputs by param key so presets can reset them
  const rangeInputs = new Map<keyof WaveParams, HTMLInputElement>();
  const numInputs   = new Map<keyof WaveParams, HTMLInputElement>();

  function fireOnChange() { onChange({ ...params }); }

  function debounceOrFire() {
    if (params.gridRes > 120) {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fireOnChange, 50);
    } else {
      fireOnChange();
    }
  }

  // ---- Preset buttons ----
  const presetsRow = document.createElement('div');
  presetsRow.style.cssText = `
    display: flex; gap: 6px; flex-wrap: wrap;
    padding: 10px 14px 10px;
    border-bottom: 1px solid #2A2A4A;
  `;

  PRESETS.forEach(preset => {
    const colors = PRESET_COLORS[preset.name] ?? { border: '#666680', activeBg: 'rgba(100,100,128,0.15)' };
    const btn = document.createElement('button');
    btn.textContent = preset.name.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
    btn.setAttribute('aria-label', `Load ${preset.name} preset`);
    btn.style.cssText = `
      font-family: 'Courier New', monospace;
      font-size: 10px;
      text-transform: uppercase;
      color: #C8C8E8;
      background: transparent;
      border: 1px solid ${colors.border};
      border-radius: 3px;
      padding: 4px 8px;
      cursor: pointer;
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;

    btn.addEventListener('click', () => {
      params = { ...preset.params };

      rangeInputs.forEach((rangeEl, key) => {
        const v = params[key] as number;
        rangeEl.value = String(v);
        rangeEl.setAttribute('aria-valuenow', String(v));
        const numEl = numInputs.get(key);
        if (numEl) numEl.value = formatValue(v, key);
      });

      presetsRow.querySelectorAll('button').forEach(b => {
        (b as HTMLButtonElement).style.background = 'transparent';
      });
      btn.style.background = colors.activeBg;

      fireOnChange();
    });

    presetsRow.appendChild(btn);
  });
  container.appendChild(presetsRow);

  // ---- Standard slider groups ----
  GROUPS.forEach(group => {
    const details = document.createElement('details');
    details.open = true;
    details.style.cssText = `background: #16162A; border-bottom: 1px solid #2A2A4A;`;

    const summary = document.createElement('summary');
    summary.textContent = group.label;
    summary.style.cssText = `
      font-family: 'Courier New', monospace;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #666680;
      padding: 8px 14px;
      cursor: pointer;
      user-select: none;
      list-style: none;
    `;
    details.appendChild(summary);

    const body = document.createElement('div');
    body.style.cssText = 'padding: 4px 14px 10px;';

    group.sliders.forEach(cfg => {
      const { key } = cfg;
      const { row, rangeEl, numEl } = buildRow(
        cfg,
        '#FF6EB4',
        () => params[key] as number,
        v => { (params as unknown as Record<string, number>)[key as string] = v; },
        fireOnChange,
        debounceOrFire,
      );
      rangeInputs.set(key, rangeEl);
      numInputs.set(key, numEl);
      body.appendChild(row);
    });

    details.appendChild(body);
    container.appendChild(details);
  });

  // ---- Wave 2 section (has a boolean enable toggle above the sliders) ----
  const wave2Details = document.createElement('details');
  wave2Details.open = false;
  wave2Details.style.cssText = `background: #16162A; border-bottom: 1px solid #2A2A4A;`;

  const wave2Summary = document.createElement('summary');
  wave2Summary.style.cssText = `
    font-family: 'Courier New', monospace;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #666680;
    padding: 8px 14px;
    cursor: pointer;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
  `;

  const wave2SummaryText = document.createElement('span');
  wave2SummaryText.textContent = 'WAVE 2 — INTERFERENCE';
  wave2Summary.appendChild(wave2SummaryText);

  const wave2Badge = document.createElement('span');
  wave2Badge.textContent = params.wave2Enabled ? 'ON' : 'OFF';
  wave2Badge.style.cssText = `
    font-size: 8px;
    padding: 1px 5px;
    border-radius: 2px;
    background: ${params.wave2Enabled ? 'rgba(0,255,204,0.2)' : 'rgba(80,80,100,0.3)'};
    color: ${params.wave2Enabled ? '#00FFCC' : '#666680'};
    border: 1px solid ${params.wave2Enabled ? '#00FFCC' : '#444460'};
  `;
  wave2Summary.appendChild(wave2Badge);
  wave2Details.appendChild(wave2Summary);

  const wave2Body = document.createElement('div');
  wave2Body.style.cssText = 'padding: 4px 14px 10px;';

  const toggleBtn = document.createElement('button');
  toggleBtn.setAttribute('aria-label', params.wave2Enabled ? 'Disable wave 2' : 'Enable wave 2');

  function updateToggleStyle() {
    const on = params.wave2Enabled;
    toggleBtn.textContent = on ? '◉ WAVE 2 ENABLED' : '◎ WAVE 2 DISABLED';
    toggleBtn.style.cssText = `
      font-family: 'Courier New', monospace;
      font-size: 10px;
      width: 100%;
      padding: 6px 10px;
      margin-bottom: 10px;
      cursor: pointer;
      border-radius: 3px;
      border: 1px solid ${on ? '#00FFCC' : '#444460'};
      background: ${on ? 'rgba(0,255,204,0.12)' : 'transparent'};
      color: ${on ? '#00FFCC' : '#666680'};
    `;
    wave2Badge.textContent = on ? 'ON' : 'OFF';
    wave2Badge.style.background = on ? 'rgba(0,255,204,0.2)' : 'rgba(80,80,100,0.3)';
    wave2Badge.style.color = on ? '#00FFCC' : '#666680';
    wave2Badge.style.borderColor = on ? '#00FFCC' : '#444460';
  }
  updateToggleStyle();

  toggleBtn.addEventListener('click', () => {
    params = { ...params, wave2Enabled: !params.wave2Enabled };
    toggleBtn.setAttribute('aria-label', params.wave2Enabled ? 'Disable wave 2' : 'Enable wave 2');
    updateToggleStyle();
    fireOnChange();
  });
  wave2Body.appendChild(toggleBtn);

  WAVE2_SLIDERS.forEach(cfg => {
    const { key } = cfg;
    const { row, rangeEl, numEl } = buildRow(
      cfg,
      '#00FFCC',
      () => params[key] as number,
      v => { (params as unknown as Record<string, number>)[key as string] = v; },
      fireOnChange,
      fireOnChange, // wave2 params are cheap — no debounce needed
    );
    rangeInputs.set(key, rangeEl);
    numInputs.set(key, numEl);
    wave2Body.appendChild(row);
  });

  wave2Details.appendChild(wave2Body);
  container.appendChild(wave2Details);
}

/**
 * Initialize the standalone time-scale control (floating right panel).
 * Only timeScale is controlled here; all other params are passed through unchanged.
 */
export function initTimeControl(
  container: HTMLElement,
  initial: WaveParams,
  onChange: (p: WaveParams) => void
): void {
  ensureNumberInputStyles();

  let params: WaveParams = { ...initial };

  const label = document.createElement('div');
  label.textContent = 'TIME';
  label.style.cssText = `
    font-family: 'Courier New', monospace;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #666680;
    margin-bottom: 6px;
    text-align: center;
  `;
  container.appendChild(label);

  // Editable number input at the top of the time panel
  const numEl = document.createElement('input');
  numEl.type = 'number';
  numEl.className = 'esurf-num';
  numEl.min = '0';
  numEl.max = '2';
  numEl.step = '0.05';
  numEl.value = params.timeScale.toFixed(2);
  numEl.style.cssText = `
    font-family: 'Courier New', monospace;
    font-size: 13px;
    color: #00FFCC;
    background: transparent;
    border: none;
    border-bottom: 1px solid #2A2A4A;
    text-align: center;
    width: 100%;
    outline: none;
    padding: 1px 0;
    margin-bottom: 6px;
    font-weight: bold;
    display: block;
  `;
  numEl.addEventListener('focus', () => { numEl.style.borderBottomColor = '#00FFCC'; });
  numEl.addEventListener('blur',  () => { numEl.style.borderBottomColor = '#2A2A4A'; });
  container.appendChild(numEl);

  const sliderWrapper = document.createElement('div');
  sliderWrapper.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: center;
    height: 120px;
  `;

  const rangeEl = document.createElement('input');
  rangeEl.type = 'range';
  rangeEl.min = '0';
  rangeEl.max = '2';
  rangeEl.step = '0.05';
  rangeEl.value = String(params.timeScale);
  rangeEl.setAttribute('aria-label', 'timeScale: simulation time multiplier (0–2)');
  rangeEl.setAttribute('aria-valuemin', '0');
  rangeEl.setAttribute('aria-valuemax', '2');
  rangeEl.setAttribute('aria-valuenow', String(params.timeScale));
  rangeEl.style.cssText = `
    writing-mode: vertical-lr;
    direction: rtl;
    width: 28px;
    height: 110px;
    accent-color: #00FFCC;
    cursor: pointer;
  `;

  // Slider → number input
  rangeEl.addEventListener('input', () => {
    const v = parseFloat(rangeEl.value);
    params = { ...params, timeScale: v };
    rangeEl.setAttribute('aria-valuenow', String(v));
    numEl.value = v.toFixed(2);
    onChange({ ...params });
  });

  // Number input → slider (real-time)
  numEl.addEventListener('input', () => {
    const raw = parseFloat(numEl.value);
    if (isNaN(raw)) return;
    const v = Math.min(2, Math.max(0, raw));
    params = { ...params, timeScale: v };
    rangeEl.value = String(v);
    rangeEl.setAttribute('aria-valuenow', String(v));
    onChange({ ...params });
  });

  // Number input → commit on blur / Enter
  numEl.addEventListener('change', () => {
    const raw = parseFloat(numEl.value);
    const v = isNaN(raw) ? params.timeScale : Math.min(2, Math.max(0, raw));
    params = { ...params, timeScale: v };
    rangeEl.value = String(v);
    rangeEl.setAttribute('aria-valuenow', String(v));
    numEl.value = v.toFixed(2);
    onChange({ ...params });
  });

  sliderWrapper.appendChild(rangeEl);
  container.appendChild(sliderWrapper);

  const hints = document.createElement('div');
  hints.style.cssText = `
    font-family: 'Courier New', monospace;
    font-size: 8px;
    color: #444460;
    text-align: center;
    margin-top: 4px;
  `;
  hints.innerHTML = 'FAST<br><br>SLOW';
  container.appendChild(hints);
}
