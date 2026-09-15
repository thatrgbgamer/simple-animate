/**
 * Colour helpers and the hex colour picker component.
 */

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeHex(value, fallback = '#000000') {
  if (typeof value !== 'string') return fallback;
  const match = value.trim().match(HEX_RE);
  if (!match) return fallback;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return '#' + hex.toUpperCase();
}

export function isValidHex(value) {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

export function hexToRgb(hex) {
  const clean = normalizeHex(hex).slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

export function rgbToHex({ r, g, b }) {
  const part = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return ('#' + part(r) + part(g) + part(b)).toUpperCase();
}

export function rgbToHsv({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
}

export function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Readable text colour for a swatch background. */
export function contrastColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#000000' : '#FFFFFF';
}

export const DEFAULT_PALETTE = [
  '#000000', '#3A3A3A', '#7A7A7A', '#B5B5B5', '#FFFFFF', '#FF4D6D', '#FF8A3D', '#FFD53D', '#8CE04A',
  '#38D39F', '#38C8D3', '#5B8CFF', '#7A5BFF', '#B56BFF', '#FF6BD6', '#8B5E3C', '#D9A066', '#F2D3B3'
];

/**
 * Saturation/value field + hue slider + hex entry + swatches.
 * Emits the chosen colour through onChange(hex).
 */
export class ColorPicker {
  constructor(container, { color = '#000000', onChange = () => {} } = {}) {
    this.container = container;
    this.onChange = onChange;
    this.hsv = rgbToHsv(hexToRgb(color));
    this.hex = normalizeHex(color);
    this.recent = [];
    this.build();
    this.render();
  }

  build() {
    this.container.classList.add('color-picker');
    this.container.innerHTML = `
      <div class="sv-field"><canvas width="220" height="132"></canvas><div class="picker-handle"></div></div>
      <div class="hue-slider"><canvas width="220" height="14"></canvas><div class="hue-handle"></div></div>
      <div class="hex-row">
        <span class="current-color"></span>
        <input type="text" class="hex-input" spellcheck="false" maxlength="7" />
      </div>
      <p class="swatch-label">Palette</p>
      <div class="swatch-grid palette"></div>
      <p class="swatch-label">Recent</p>
      <div class="swatch-grid recent"></div>
    `;

    this.svField = this.container.querySelector('.sv-field');
    this.svCanvas = this.svField.querySelector('canvas');
    this.svCtx = this.svCanvas.getContext('2d');
    this.svHandle = this.svField.querySelector('.picker-handle');

    this.hueSlider = this.container.querySelector('.hue-slider');
    this.hueCanvas = this.hueSlider.querySelector('canvas');
    this.hueHandle = this.hueSlider.querySelector('.hue-handle');

    this.preview = this.container.querySelector('.current-color');
    this.hexInput = this.container.querySelector('.hex-input');
    this.paletteEl = this.container.querySelector('.swatch-grid.palette');
    this.recentEl = this.container.querySelector('.swatch-grid.recent');

    this.drawHue();
    this.bindField(this.svField, (x, y, rect) => {
      this.hsv.s = clamp01(x / rect.width);
      this.hsv.v = 1 - clamp01(y / rect.height);
      this.commitFromHsv();
    });
    this.bindField(this.hueSlider, (x, _y, rect) => {
      this.hsv.h = clamp01(x / rect.width) * 359.99;
      this.commitFromHsv();
    });

    this.hexInput.addEventListener('input', () => {
      if (isValidHex(this.hexInput.value)) this.setColor(this.hexInput.value, { fromInput: true });
    });
    this.hexInput.addEventListener('blur', () => { this.hexInput.value = this.hex; });
    this.hexInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.hexInput.blur();
      event.stopPropagation();
    });

    for (const hex of DEFAULT_PALETTE) {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.background = hex;
      button.title = hex;
      button.addEventListener('click', () => this.setColor(hex));
      this.paletteEl.appendChild(button);
    }
  }

  bindField(element, handler) {
    const run = (event) => {
      const rect = element.getBoundingClientRect();
      handler(clamp(event.clientX - rect.left, 0, rect.width), clamp(event.clientY - rect.top, 0, rect.height), rect);
    };
    element.addEventListener('pointerdown', (event) => {
      element.setPointerCapture(event.pointerId);
      run(event);
      const move = (moveEvent) => run(moveEvent);
      const up = () => {
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerup', up);
        this.pushRecent(this.hex);
      };
      element.addEventListener('pointermove', move);
      element.addEventListener('pointerup', up);
    });
  }

  commitFromHsv() {
    this.hex = rgbToHex(hsvToRgb(this.hsv));
    this.render();
    this.onChange(this.hex);
  }

  setColor(hex, { fromInput = false, silent = false } = {}) {
    this.hex = normalizeHex(hex, this.hex);
    const hsv = rgbToHsv(hexToRgb(this.hex));
    // Keep the hue handle where the user left it for greys and pure black/white.
    this.hsv = { h: hsv.s === 0 ? this.hsv.h : hsv.h, s: hsv.s, v: hsv.v };
    this.render({ skipInput: fromInput });
    if (!silent) this.onChange(this.hex);
  }

  pushRecent(hex) {
    const value = normalizeHex(hex);
    this.recent = [value, ...this.recent.filter((c) => c !== value)].slice(0, 18);
    this.renderRecent();
  }

  renderRecent() {
    this.recentEl.innerHTML = '';
    for (const hex of this.recent) {
      const button = document.createElement('button');
      button.type = 'button';
      button.style.background = hex;
      button.title = hex;
      button.addEventListener('click', () => this.setColor(hex));
      this.recentEl.appendChild(button);
    }
  }

  drawHue() {
    const ctx = this.hueCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, this.hueCanvas.width, 0);
    for (let i = 0; i <= 6; i++) {
      gradient.addColorStop(i / 6, rgbToHex(hsvToRgb({ h: (i / 6) * 359.99, s: 1, v: 1 })));
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.hueCanvas.width, this.hueCanvas.height);
  }

  render({ skipInput = false } = {}) {
    const { width, height } = this.svCanvas;
    const ctx = this.svCtx;

    ctx.fillStyle = rgbToHex(hsvToRgb({ h: this.hsv.h, s: 1, v: 1 }));
    ctx.fillRect(0, 0, width, height);

    const white = ctx.createLinearGradient(0, 0, width, 0);
    white.addColorStop(0, 'rgba(255,255,255,1)');
    white.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, width, height);

    const black = ctx.createLinearGradient(0, 0, 0, height);
    black.addColorStop(0, 'rgba(0,0,0,0)');
    black.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, width, height);

    this.svHandle.style.left = `${this.hsv.s * 100}%`;
    this.svHandle.style.top = `${(1 - this.hsv.v) * 100}%`;
    this.svHandle.style.background = this.hex;
    this.hueHandle.style.left = `${(this.hsv.h / 359.99) * 100}%`;
    this.preview.style.background = this.hex;
    if (!skipInput) this.hexInput.value = this.hex;
  }
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(value, 0, 1); }
