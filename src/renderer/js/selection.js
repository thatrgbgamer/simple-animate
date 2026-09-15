/**
 * Lasso selection and the stretch (free transform) tool.
 *
 * A selection is a free-form polygon plus an alpha mask. Once the pixels are
 * "lifted" they live in a floating piece that can be dragged, stretched,
 * copied, cut or pasted, and is stamped back into the frame on commit.
 */

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Integer bounding box of a point list, clamped to the canvas and padded. */
export function boundsFromPoints(points, maxWidth, maxHeight, pad = 1) {
  if (!points || points.length < 3) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x = Math.max(0, Math.floor(minX) - pad);
  const y = Math.max(0, Math.floor(minY) - pad);
  const right = Math.min(maxWidth, Math.ceil(maxX) + pad);
  const bottom = Math.min(maxHeight, Math.ceil(maxY) + pad);
  const w = right - x;
  const h = bottom - y;
  if (w < 2 || h < 2) return null;
  return { x, y, w, h };
}

/** White silhouette of the lasso path, sized to its bounds. */
export function makeMask(points, bounds) {
  const mask = document.createElement('canvas');
  mask.width = bounds.w;
  mask.height = bounds.h;
  const ctx = mask.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  points.forEach((p, index) => {
    const x = p.x - bounds.x;
    const y = p.y - bounds.y;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  return mask;
}

/** Copies the masked pixels of a frame into a new canvas. */
export function extractRegion(frameCanvas, bounds, mask) {
  const out = document.createElement('canvas');
  out.width = bounds.w;
  out.height = bounds.h;
  const ctx = out.getContext('2d');
  ctx.drawImage(frameCanvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  return out;
}

/** Punches the masked area out of a frame. */
export function clearRegion(frameCtx, bounds, mask) {
  frameCtx.save();
  frameCtx.globalCompositeOperation = 'destination-out';
  frameCtx.drawImage(mask, bounds.x, bounds.y);
  frameCtx.restore();
}

/** True when a project-space point falls inside the mask. */
export function maskContains(selection, x, y) {
  const { bounds, mask } = selection;
  const px = Math.floor(x - bounds.x);
  const py = Math.floor(y - bounds.y);
  if (px < 0 || py < 0 || px >= bounds.w || py >= bounds.h) return false;
  if (!selection._maskData) {
    selection._maskData = mask.getContext('2d').getImageData(0, 0, bounds.w, bounds.h).data;
  }
  return selection._maskData[(py * bounds.w + px) * 4 + 3] > 8;
}

/* -------------------------------------------------------- floating art --- */

/**
 * @param {HTMLCanvasElement} canvas pixels to place
 * @param {{x,y,w,h}} rect destination rectangle (w/h may go negative = flipped)
 */
export function createFloating({ canvas, rect, points = null, origin = null, mask = null }) {
  return {
    canvas,
    mask,
    rect: { ...rect },
    origin: origin ? { ...origin } : { ...rect },
    points: points ? points.map((p) => ({ ...p })) : null,
    moved: false
  };
}

/** Draws a floating piece, honouring negative width/height as a flip. */
export function drawFloating(ctx, floating, { smooth = true } = {}) {
  const { x, y, w, h } = floating.rect;
  ctx.save();
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(x + (w < 0 ? w : 0), y + (h < 0 ? h : 0));
  ctx.scale(w < 0 ? -1 : 1, h < 0 ? -1 : 1);
  ctx.drawImage(floating.canvas, 0, 0, Math.abs(w), Math.abs(h));
  ctx.restore();
}

/** The lasso outline, follows the piece as it is moved or stretched. */
export function floatingOutline(floating) {
  const { rect, origin, points } = floating;
  if (!points || !origin || origin.w === 0 || origin.h === 0) {
    return [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h }
    ];
  }
  const sx = rect.w / origin.w;
  const sy = rect.h / origin.h;
  return points.map((p) => ({
    x: rect.x + (p.x - origin.x) * sx,
    y: rect.y + (p.y - origin.y) * sy
  }));
}

export function normalizeRect(rect) {
  return {
    x: rect.w < 0 ? rect.x + rect.w : rect.x,
    y: rect.h < 0 ? rect.y + rect.h : rect.y,
    w: Math.abs(rect.w),
    h: Math.abs(rect.h)
  };
}

/* ------------------------------------------------------------- handles --- */

/** Returns the handle under a point, 'inside', or null. */
export function handleAt(rect, x, y, tolerance) {
  const norm = normalizeRect(rect);
  const positions = handlePositions(norm);
  for (const [name, pos] of Object.entries(positions)) {
    if (Math.abs(x - pos.x) <= tolerance && Math.abs(y - pos.y) <= tolerance) return name;
  }
  if (x >= norm.x - tolerance && x <= norm.x + norm.w + tolerance &&
      y >= norm.y - tolerance && y <= norm.y + norm.h + tolerance) return 'inside';
  return null;
}

export function handlePositions(rect) {
  const { x, y, w, h } = rect;
  return {
    nw: { x, y },
    n: { x: x + w / 2, y },
    ne: { x: x + w, y },
    e: { x: x + w, y: y + h / 2 },
    se: { x: x + w, y: y + h },
    s: { x: x + w / 2, y: y + h },
    sw: { x, y: y + h },
    w: { x, y: y + h / 2 }
  };
}

export const HANDLE_CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
  inside: 'move'
};

/**
 * Stretches a rectangle by dragging one handle.
 * `startRect` is the rect when the drag began, `pointer` the current position.
 */
export function stretchRect(startRect, handle, pointer, { keepAspect = false, fromCenter = false } = {}) {
  const rect = { ...startRect };
  const right = startRect.x + startRect.w;
  const bottom = startRect.y + startRect.h;
  const centerX = startRect.x + startRect.w / 2;
  const centerY = startRect.y + startRect.h / 2;
  const touchesLeft = handle.includes('w');
  const touchesRight = handle.includes('e');
  const touchesTop = handle.includes('n');
  const touchesBottom = handle.includes('s');

  if (touchesLeft) { rect.x = pointer.x; rect.w = right - pointer.x; }
  if (touchesRight) { rect.w = pointer.x - startRect.x; }
  if (touchesTop) { rect.y = pointer.y; rect.h = bottom - pointer.y; }
  if (touchesBottom) { rect.h = pointer.y - startRect.y; }

  if (keepAspect && startRect.w !== 0 && startRect.h !== 0) {
    const ratio = Math.abs(startRect.w / startRect.h);
    const corner = (touchesLeft || touchesRight) && (touchesTop || touchesBottom);
    if (corner) {
      // Follow whichever axis the pointer pushed further.
      if (Math.abs(rect.w) / ratio > Math.abs(rect.h)) {
        const h = Math.sign(rect.h || 1) * Math.abs(rect.w) / ratio;
        if (touchesTop) rect.y = bottom - h;
        rect.h = h;
      } else {
        const w = Math.sign(rect.w || 1) * Math.abs(rect.h) * ratio;
        if (touchesLeft) rect.x = right - w;
        rect.w = w;
      }
    } else if (touchesLeft || touchesRight) {
      const h = Math.sign(startRect.h || 1) * Math.abs(rect.w) / ratio;
      rect.y = centerY - h / 2;
      rect.h = h;
    } else {
      const w = Math.sign(startRect.w || 1) * Math.abs(rect.h) * ratio;
      rect.x = centerX - w / 2;
      rect.w = w;
    }
  }

  if (fromCenter) {
    if (touchesLeft || touchesRight) {
      const halfWidth = (touchesRight ? pointer.x - centerX : centerX - pointer.x);
      rect.w = halfWidth * 2;
      rect.x = centerX - rect.w / 2;
    }
    if (touchesTop || touchesBottom) {
      const halfHeight = (touchesBottom ? pointer.y - centerY : centerY - pointer.y);
      rect.h = halfHeight * 2;
      rect.y = centerY - rect.h / 2;
    }
  }

  return rect;
}

/* ----------------------------------------------------------- overlay ----- */

/** Marching ants: a dark line with a white dashed line running along it. */
export function drawAnts(ctx, points, { scale = 1, offset = 0, closed = true } = {}) {
  if (!points || points.length < 2) return;
  const trace = () => {
    ctx.beginPath();
    points.forEach((p, index) => (index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (closed) ctx.closePath();
  };

  ctx.save();
  ctx.lineWidth = 1.4 / scale;
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  trace();
  ctx.stroke();

  ctx.setLineDash([5 / scale, 5 / scale]);
  ctx.lineDashOffset = -offset / scale;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  trace();
  ctx.stroke();
  ctx.restore();
}

/** The eight stretch grips. */
export function drawHandles(ctx, rect, { scale = 1 } = {}) {
  const norm = normalizeRect(rect);
  const size = 9 / scale;
  ctx.save();
  ctx.lineWidth = 1.4 / scale;
  for (const pos of Object.values(handlePositions(norm))) {
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.beginPath();
    ctx.rect(pos.x - size / 2, pos.y - size / 2, size, size);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
