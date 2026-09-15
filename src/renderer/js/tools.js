/**
 * Drawing primitives. Everything here works on a plain 2D context so the same
 * code serves the live preview layer and the committed frame.
 */

import { hexToRgb } from './color.js';

export const TOOLS = [
  { id: 'brush', label: 'Brush', key: 'B', shape: false, icon: 'M3 17c3 1 5-1 6-3s2-4 4-6 3-2 4-1 0 3-2 5-4 3-6 4-4 2-6 1z M13 7l4 4' },
  { id: 'eraser', label: 'Eraser', key: 'E', shape: false, icon: 'M4 16l7-7 5 5-3 3H7z M14 6l4 4-3 3-5-5z M3 20h18' },
  { id: 'lasso', label: 'Lasso select — circle an area to copy, cut or move', key: 'V', shape: false, icon: 'M12 4c4.4 0 8 2.5 8 5.5S16.4 15 12 15c-1 0-2-.1-2.9-.4 M9.1 14.6C6.1 13.7 4 11.8 4 9.5 4 6.5 7.6 4 12 4 M9 15c-1.3 1.2-1.3 3.4 0 4.6' },
  { id: 'stretch', label: 'Stretch — scale the selection or the whole frame', key: 'K', shape: false, icon: 'M5 5h6v6H5z M13 13h6v6h-6z M11 11l2 2 M15 5h4v4 M19 5l-5 5 M9 19H5v-4 M5 19l5-5' },
  { id: 'fill', label: 'Paint bucket', key: 'G', shape: false, icon: 'M5 11l6-6 7 7-6 6a2.8 2.8 0 01-4 0l-3-3a2.8 2.8 0 010-4z M11 5L9 3 M19 16c0 1.7 1 2.6 1 2.6s1-.9 1-2.6a1 1 0 00-2 0z' },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I', shape: false, icon: 'M15 4a2.5 2.5 0 013.5 3.5L16 10l-2-2z M14 10L5 19v0h0l-1 1 1-1v-3l9-9 z M12 8l4 4' },
  { id: 'line', label: 'Line', key: 'L', shape: true, icon: 'M4 20L20 4 M4 20h0 M20 4h0' },
  { id: 'rect', label: 'Rectangle', key: 'R', shape: true, icon: 'M4 6h16v12H4z' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', shape: true, icon: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z' },
  { id: 'triangle', label: 'Triangle', key: 'T', shape: true, icon: 'M12 5l8 14H4z' },
  { id: 'polygon', label: 'Polygon', key: 'P', shape: true, icon: 'M12 4l7 5-2.7 8H7.7L5 9z' },
  { id: 'star', label: 'Star', key: 'S', shape: true, icon: 'M12 4l2.4 5.2 5.6.7-4.2 3.9 1.1 5.6L12 16.7 7.1 19.4l1.1-5.6L4 9.9l5.6-.7z' }
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((tool) => [tool.id, tool]));

/* ------------------------------------------------------------- strokes --- */

/**
 * Incremental freehand stroke. Points are smoothed through their midpoints so
 * fast gestures stay round instead of turning into polygons.
 */
export class StrokeBuilder {
  constructor(ctx, { size, color }) {
    this.ctx = ctx;
    this.size = size;
    this.color = color;
    this.points = [];
    this.configure();
  }

  configure() {
    const ctx = this.ctx;
    ctx.lineWidth = this.size;
    ctx.strokeStyle = this.color;
    ctx.fillStyle = this.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  add(point) {
    this.points.push(point);
    const n = this.points.length;
    const ctx = this.ctx;

    if (n === 1) {
      // A tap still leaves a dot.
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(this.size / 2, 0.35), 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (n === 2) {
      const [a, b] = this.points;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(midpoint(a, b).x, midpoint(a, b).y);
      ctx.stroke();
      return;
    }

    const c = this.points[n - 1];
    const b = this.points[n - 2];
    const a = this.points[n - 3];
    const from = midpoint(a, b);
    const to = midpoint(b, c);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(b.x, b.y, to.x, to.y);
    ctx.stroke();
  }

  finish() {
    const n = this.points.length;
    if (n < 2) return;
    const last = this.points[n - 1];
    const prev = this.points[n - 2];
    const ctx = this.ctx;
    ctx.beginPath();
    const from = midpoint(prev, last);
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/* -------------------------------------------------------------- shapes --- */

/**
 * Draws one of the shape tools between two points.
 * `constrain` squares off rectangles/ellipses and snaps lines to 45°.
 */
export function drawShape(ctx, { tool, start, end, size, color, fill, fromCenter, constrain, sides = 5 }) {
  let { x: x0, y: y0 } = start;
  let { x: x1, y: y1 } = end;

  if (constrain && tool === 'line') {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const length = Math.hypot(dx, dy);
    x1 = x0 + Math.cos(angle) * length;
    y1 = y0 + Math.sin(angle) * length;
  } else if (constrain && tool !== 'line') {
    const side = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    x1 = x0 + Math.sign(x1 - x0 || 1) * side;
    y1 = y0 + Math.sign(y1 - y0 || 1) * side;
  }

  if (fromCenter && tool !== 'line') {
    const dx = x1 - x0;
    const dy = y1 - y0;
    x0 -= dx;
    y0 -= dy;
  }

  ctx.save();
  ctx.lineWidth = size;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);

  switch (tool) {
    case 'line':
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      break;
    case 'rect':
      ctx.rect(left, top, width, height);
      break;
    case 'ellipse':
      ctx.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(left + width / 2, top);
      ctx.lineTo(left + width, top + height);
      ctx.lineTo(left, top + height);
      ctx.closePath();
      break;
    case 'polygon':
      tracePolygon(ctx, left + width / 2, top + height / 2, width / 2, height / 2, Math.max(3, sides), false);
      break;
    case 'star':
      tracePolygon(ctx, left + width / 2, top + height / 2, width / 2, height / 2, Math.max(3, sides), true);
      break;
    default:
      break;
  }

  if (fill && tool !== 'line') ctx.fill();
  if (size > 0) ctx.stroke();
  ctx.restore();
}

function tracePolygon(ctx, cx, cy, rx, ry, sides, star) {
  const points = star ? sides * 2 : sides;
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
    const scale = star && i % 2 === 1 ? 0.45 : 1;
    const x = cx + Math.cos(angle) * rx * scale;
    const y = cy + Math.sin(angle) * ry * scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/* ---------------------------------------------------------- flood fill --- */

/**
 * Scanline flood fill with tolerance, in place on the given context.
 * Returns true when anything changed.
 */
export function floodFill(ctx, startX, startY, hex, { tolerance = 32, alpha = 1 } = {}) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const x = Math.floor(startX);
  const y = Math.floor(startY);
  if (x < 0 || y < 0 || x >= width || y >= height) return false;

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const startIndex = (y * width + x) * 4;

  const target = [data[startIndex], data[startIndex + 1], data[startIndex + 2], data[startIndex + 3]];
  const { r, g, b } = hexToRgb(hex);
  const fillColor = [r, g, b, Math.round(alpha * 255)];

  if (colorsEqual(target, fillColor) && tolerance === 0) return false;

  const limit = tolerance * tolerance * 4;
  const visited = new Uint8Array(width * height);
  const stack = [x, y];
  let changed = false;

  const matches = (index) => {
    const dr = data[index] - target[0];
    const dg = data[index + 1] - target[1];
    const db = data[index + 2] - target[2];
    const da = data[index + 3] - target[3];
    // Transparent pixels compare on alpha alone — RGB is meaningless there.
    if (target[3] === 0) return data[index + 3] <= tolerance;
    return dr * dr + dg * dg + db * db + da * da <= limit;
  };

  while (stack.length) {
    const py = stack.pop();
    const px = stack.pop();
    let rowStart = py * width;
    let left = px;

    while (left >= 0 && !visited[rowStart + left] && matches((rowStart + left) * 4)) left--;
    left++;

    let spanUp = false;
    let spanDown = false;

    for (let cx = left; cx < width && !visited[rowStart + cx] && matches((rowStart + cx) * 4); cx++) {
      const index = (rowStart + cx) * 4;
      data[index] = fillColor[0];
      data[index + 1] = fillColor[1];
      data[index + 2] = fillColor[2];
      data[index + 3] = fillColor[3];
      visited[rowStart + cx] = 1;
      changed = true;

      if (py > 0) {
        const upIndex = ((py - 1) * width + cx) * 4;
        const up = !visited[(py - 1) * width + cx] && matches(upIndex);
        if (up && !spanUp) { stack.push(cx, py - 1); spanUp = true; }
        else if (!up) spanUp = false;
      }
      if (py < height - 1) {
        const downIndex = ((py + 1) * width + cx) * 4;
        const down = !visited[(py + 1) * width + cx] && matches(downIndex);
        if (down && !spanDown) { stack.push(cx, py + 1); spanDown = true; }
        else if (!down) spanDown = false;
      }
    }
  }

  if (changed) ctx.putImageData(image, 0, 0);
  return changed;
}

function colorsEqual(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Reads a pixel, returning null when it is fully transparent. */
export function pickColorAt(ctx, x, y) {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= ctx.canvas.width || py >= ctx.canvas.height) return null;
  const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data;
  if (a === 0) return null;
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}
