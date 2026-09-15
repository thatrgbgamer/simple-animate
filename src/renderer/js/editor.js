/**
 * The animation editor: canvas, tools, selection, onion skin, timeline.
 */

import { TOOLS, TOOL_BY_ID, StrokeBuilder, drawShape, floodFill, pickColorAt } from './tools.js';
import * as sel from './selection.js';
import { ColorPicker, normalizeHex, isValidHex } from './color.js';
import { History } from './history.js';
import { createFrameCanvas, cloneFrameCanvas, resizeFrames, clampSize } from './project.js';

const $ = (id) => document.getElementById(id);
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 16;

export class Editor {
  constructor(app) {
    this.app = app;
    this.project = null;
    this.index = 0;

    this.tool = 'brush';
    this.color = '#000000';
    this.sizes = { brush: 8, eraser: 28, shape: 6 };
    this.opacity = 1;
    this.shape = { fill: false, fromCenter: false, sides: 5 };
    this.tolerance = 32;

    this.onion = { enabled: true, before: 1, after: 1, opacity: 0.45, falloff: 0.55, tint: true, loop: false };

    this.zoom = 1;
    this.pan = { x: 0, y: 0 };

    this.playing = false;
    this.loop = true;

    this.selection = null;
    this.floating = null;
    this.clipboard = null;
    this.antsOffset = 0;

    this.stroke = null;
    this.drag = null;
    this.thumbs = [];

    this.history = new History({ onChange: () => this.updateHistoryButtons() });
  }

  /* ------------------------------------------------------------- setup --- */

  mount() {
    this.stageWrap = $('stage-wrap');
    this.stage = $('stage');
    this.display = $('display-canvas');
    this.displayCtx = this.display.getContext('2d');
    this.onionCanvas = $('onion-canvas');
    this.onionCtx = this.onionCanvas.getContext('2d');
    this.cursorRing = $('cursor-ring');
    this.strip = $('frame-strip');

    this.buildToolButtons();
    this.bindTools();
    this.bindStage();
    this.bindPanels();
    this.bindTimeline();
    this.bindKeyboard();

    this.picker = new ColorPicker($('color-picker'), {
      color: this.color,
      onChange: (hex) => { this.color = hex; this.updateSizePreview(); }
    });

    window.addEventListener('resize', () => {
      if (this.project && this.app.currentView === 'editor') this.clampPan();
    });

    setInterval(() => {
      if ((this.selection || this.floating) && !this.playing && this.app.currentView === 'editor') {
        this.antsOffset = (this.antsOffset + 1) % 10;
        this.repaint();
      }
    }, 90);
  }

  buildToolButtons() {
    const grid = $('tool-grid');
    grid.innerHTML = '';
    for (const tool of TOOLS) {
      const button = document.createElement('button');
      button.className = 'tool-btn';
      button.dataset.tool = tool.id;
      button.title = `${tool.label} (${tool.key})`;
      button.innerHTML = `<svg viewBox="0 0 24 24">${tool.icon
        .split(' M')
        .map((segment, i) => `<path d="${i === 0 ? segment : 'M' + segment}"/>`)
        .join('')}</svg>`;
      button.addEventListener('click', () => this.setTool(tool.id));
      grid.appendChild(button);
    }
  }

  setProject(project) {
    this.project = project;
    this.index = 0;
    this.selection = null;
    this.floating = null;
    this.history.clear();
    this.strokeLayer = createFrameCanvas(project.width, project.height);
    this.tintCanvas = createFrameCanvas(project.width, project.height);
    this.syncCanvasSize();
    this.zoomToFit();
    this.renderTimeline();
    this.syncPanels();
    this.repaint();
  }

  get frame() { return this.project.frames[this.index]; }
  get frameCtx() { return this.frame.getContext('2d'); }

  syncCanvasSize() {
    const { width, height } = this.project;
    for (const canvas of [this.display, this.onionCanvas]) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    if (this.strokeLayer.width !== width || this.strokeLayer.height !== height) {
      this.strokeLayer = createFrameCanvas(width, height);
      this.tintCanvas = createFrameCanvas(width, height);
    }
    this.stage.classList.toggle('solid', Boolean(this.project.background));
    this.stage.style.backgroundColor = this.project.background || '';
    $('canvas-size-chip').textContent = `${width} × ${height}`;
    this.applyZoom();
  }

  /* -------------------------------------------------------- view / zoom -- */

  applyZoom() {
    const { width, height } = this.project;
    this.stage.style.width = `${Math.round(width * this.zoom)}px`;
    this.stage.style.height = `${Math.round(height * this.zoom)}px`;
    this.stage.style.transform = `translate(${Math.round(this.pan.x)}px, ${Math.round(this.pan.y)}px)`;
    this.stage.classList.toggle('pixelated', this.zoom >= 4);
    $('zoom-level').textContent = `${Math.round(this.zoom * 100)}%`;
  }

  zoomToFit() {
    const rect = this.stageWrap.getBoundingClientRect();
    const available = { w: Math.max(80, rect.width - 64), h: Math.max(80, rect.height - 64) };
    this.zoom = clamp(Math.min(available.w / this.project.width, available.h / this.project.height), MIN_ZOOM, MAX_ZOOM);
    this.pan = { x: 0, y: 0 };
    this.applyZoom();
  }

  zoomBy(factor, anchor = null) {
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (anchor) {
      this.pan.x += (this.zoom - next) * (anchor.x - this.project.width / 2);
      this.pan.y += (this.zoom - next) * (anchor.y - this.project.height / 2);
    }
    this.zoom = next;
    this.applyZoom();
  }

  clampPan() {
    const rect = this.stageWrap.getBoundingClientRect();
    const limitX = (this.project.width * this.zoom + rect.width) / 2;
    const limitY = (this.project.height * this.zoom + rect.height) / 2;
    this.pan.x = clamp(this.pan.x, -limitX, limitX);
    this.pan.y = clamp(this.pan.y, -limitY, limitY);
    this.applyZoom();
  }

  toProject(event) {
    const rect = this.display.getBoundingClientRect();
    const scale = rect.width / this.project.width;
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  }

  get screenScale() {
    return this.display.getBoundingClientRect().width / this.project.width;
  }

  /* ------------------------------------------------------------ paint ---- */

  repaint() {
    if (!this.project) return;
    const ctx = this.displayCtx;
    const { width, height } = this.project;

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.frame, 0, 0);

    if (this.stroke) {
      ctx.save();
      ctx.globalAlpha = this.opacity;
      if (this.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(this.strokeLayer, 0, 0);
      ctx.restore();
    }

    if (this.floating) sel.drawFloating(ctx, this.floating);

    if (!this.playing) this.drawOverlay(ctx);
  }

  drawOverlay(ctx) {
    const scale = this.screenScale || 1;

    if (this.drag && this.drag.type === 'lasso') {
      sel.drawAnts(ctx, this.drag.points, { scale, offset: this.antsOffset, closed: false });
      return;
    }
    if (this.floating) {
      sel.drawAnts(ctx, sel.floatingOutline(this.floating), { scale, offset: this.antsOffset });
      if (this.tool === 'stretch') sel.drawHandles(ctx, this.floating.rect, { scale });
      return;
    }
    if (this.selection && (this.tool === 'lasso' || this.tool === 'stretch')) {
      sel.drawAnts(ctx, this.selection.points, { scale, offset: this.antsOffset });
    }
  }

  repaintOnion() {
    if (!this.project) return;
    const ctx = this.onionCtx;
    const { width, height } = this.project;
    ctx.clearRect(0, 0, width, height);
    if (!this.onion.enabled || this.playing) return;

    const total = this.project.frames.length;
    const draw = (offset, tint) => {
      let target = this.index + offset;
      if (this.onion.loop) target = ((target % total) + total) % total;
      if (target < 0 || target >= total || target === this.index) return;
      const step = Math.abs(offset);
      const alpha = this.onion.opacity * Math.pow(1 - this.onion.falloff, step - 1);
      if (alpha <= 0.01) return;
      this.drawTinted(this.project.frames[target], this.onion.tint ? tint : null, alpha);
    };

    for (let i = this.onion.before; i >= 1; i--) draw(-i, '#FF4D6D');
    for (let i = this.onion.after; i >= 1; i--) draw(i, '#5B8CFF');
  }

  drawTinted(frame, tint, alpha) {
    const temp = this.tintCanvas;
    const tctx = temp.getContext('2d');
    tctx.clearRect(0, 0, temp.width, temp.height);
    tctx.drawImage(frame, 0, 0);
    if (tint) {
      tctx.save();
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = tint;
      tctx.fillRect(0, 0, temp.width, temp.height);
      tctx.restore();
    }
    this.onionCtx.save();
    this.onionCtx.globalAlpha = alpha;
    this.onionCtx.drawImage(temp, 0, 0);
    this.onionCtx.restore();
  }

  /* ------------------------------------------------------------ tools ---- */

  setTool(id) {
    if (!TOOL_BY_ID[id]) return;
    const leavingSelection = (this.tool === 'lasso' || this.tool === 'stretch') && id !== 'lasso' && id !== 'stretch';
    if (leavingSelection) {
      this.commitFloating();
      this.selection = null;
    }

    this.tool = id;
    for (const button of document.querySelectorAll('.tool-btn')) {
      button.classList.toggle('active', button.dataset.tool === id);
    }

    const tool = TOOL_BY_ID[id];
    $('shape-block').hidden = !tool.shape;
    $('fill-block').hidden = id !== 'fill';
    $('select-block').hidden = !(id === 'lasso' || id === 'stretch');
    $('brush-block').hidden = !['brush', 'eraser', 'line', 'rect', 'ellipse', 'triangle', 'polygon', 'star'].includes(id);
    $('polygon-row').hidden = !(id === 'polygon' || id === 'star');

    $('select-hint').innerHTML = id === 'stretch'
      ? 'Drag a handle to stretch, or drag inside to move. <kbd>Shift</kbd> keeps the proportions, <kbd>Alt</kbd> stretches from the centre. <kbd>Enter</kbd> applies, <kbd>Esc</kbd> cancels.'
      : 'Circle an area to select it, then drag inside to move it. <kbd>Ctrl/Cmd</kbd>+<kbd>C</kbd> copy, <kbd>X</kbd> cut, <kbd>V</kbd> paste, <kbd>Esc</kbd> deselect.';

    if (id === 'stretch') this.beginStretch();
    this.updateSizeUI();
    this.updateCursor();
    this.repaint();
  }

  sizeGroup(tool = this.tool) {
    if (tool === 'brush') return 'brush';
    if (tool === 'eraser') return 'eraser';
    return 'shape';
  }

  get size() { return this.sizes[this.sizeGroup()]; }

  updateSizeUI() {
    const group = this.sizeGroup();
    const size = this.sizes[group];
    $('size-label').textContent = group === 'brush' ? 'Brush size' : group === 'eraser' ? 'Eraser size' : 'Line thickness';
    $('size-value').textContent = `${size} px`;
    $('tool-size').value = size;
    $('tool-size-num').value = size;
    this.updateSizePreview();
  }

  updateSizePreview() {
    const dot = $('size-dot');
    const size = Math.min(this.size, 36);
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.background = this.tool === 'eraser' ? '#8B93A5' : this.color;
    dot.style.opacity = String(this.opacity);
  }

  setSize(value) {
    const size = clamp(Math.round(Number(value) || 1), 1, 300);
    this.sizes[this.sizeGroup()] = size;
    this.updateSizeUI();
    this.updateCursor();
  }

  updateCursor() {
    const usesRing = this.tool === 'brush' || this.tool === 'eraser';
    this.stageWrap.classList.toggle('drawing', usesRing);
    this.stageWrap.classList.toggle('selecting', this.tool === 'lasso');
    if (!usesRing) this.cursorRing.hidden = true;
  }

  /* --------------------------------------------------------- selection --- */

  setSelectionFromPoints(points) {
    const bounds = sel.boundsFromPoints(points, this.project.width, this.project.height);
    if (!bounds) { this.selection = null; return false; }
    this.selection = { points, bounds, mask: sel.makeMask(points, bounds) };
    return true;
  }

  selectAll() {
    const { width, height } = this.project;
    this.commitFloating();
    this.setSelectionFromPoints([
      { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }
    ]);
    if (this.tool !== 'lasso' && this.tool !== 'stretch') this.setTool('lasso');
    this.repaint();
  }

  deselect() {
    this.commitFloating();
    this.selection = null;
    this.repaint();
  }

  /** Moves the selected pixels into a floating piece that can be dragged. */
  liftSelection({ erase = true } = {}) {
    if (!this.selection || this.floating) return this.floating;
    const frame = this.frame;
    const before = this.snapshot(frame);
    const region = sel.extractRegion(frame, this.selection.bounds, this.selection.mask);
    if (erase) sel.clearRegion(frame.getContext('2d'), this.selection.bounds, this.selection.mask);

    this.floating = sel.createFloating({
      canvas: region,
      rect: { ...this.selection.bounds },
      points: this.selection.points,
      origin: this.selection.bounds,
      mask: this.selection.mask
    });
    this.floating.before = before;
    this.floating.frame = frame;
    return this.floating;
  }

  /** Stamps the floating piece back into its frame. */
  commitFloating() {
    const floating = this.floating;
    if (!floating) return false;
    this.floating = null;

    const rect = sel.normalizeRect(floating.rect);
    const changed = floating.moved || rect.x !== floating.origin.x || rect.y !== floating.origin.y ||
      rect.w !== floating.origin.w || rect.h !== floating.origin.h;

    sel.drawFloating(floating.frame.getContext('2d'), floating);

    if (changed || floating.pasted) {
      this.pushPixelHistory(floating.frame, floating.before, 'selection');
      this.app.markDirty();
    }

    const outline = sel.floatingOutline(floating);
    this.setSelectionFromPoints(outline);
    this.updateThumb(this.project.frames.indexOf(floating.frame));
    this.repaint();
    return changed;
  }

  cancelFloating() {
    const floating = this.floating;
    if (!floating) return;
    floating.frame.getContext('2d').putImageData(floating.before, 0, 0);
    this.floating = null;
    this.updateThumb(this.project.frames.indexOf(floating.frame));
    this.repaint();
  }

  copySelection({ cut = false } = {}) {
    if (this.floating) {
      const copy = createFrameCanvas(Math.abs(this.floating.rect.w), Math.abs(this.floating.rect.h));
      copy.getContext('2d').drawImage(this.floating.canvas, 0, 0, copy.width, copy.height);
      this.clipboard = { canvas: copy, rect: sel.normalizeRect(this.floating.rect), points: sel.floatingOutline(this.floating) };
      if (cut) {
        // The pixels left the frame when they were lifted, so dropping the
        // floating piece *is* the cut.
        const floating = this.floating;
        this.floating = null;
        this.selection = null;
        this.pushPixelHistory(floating.frame, floating.before, 'cut');
        this.updateThumb(this.project.frames.indexOf(floating.frame));
        this.repaint();
        this.app.markDirty();
      }
      this.app.toast(cut ? 'Cut to clipboard' : 'Copied to clipboard');
      return true;
    }

    if (!this.selection) {
      this.app.toast('Nothing selected — circle an area with the lasso first.', 'error');
      return false;
    }

    const region = sel.extractRegion(this.frame, this.selection.bounds, this.selection.mask);
    this.clipboard = { canvas: region, rect: { ...this.selection.bounds }, points: this.selection.points.map((p) => ({ ...p })) };

    if (cut) {
      const before = this.snapshot(this.frame);
      sel.clearRegion(this.frameCtx, this.selection.bounds, this.selection.mask);
      this.pushPixelHistory(this.frame, before, 'cut');
      this.afterFrameEdit();
    }
    this.app.toast(cut ? 'Cut to clipboard' : 'Copied to clipboard');
    return true;
  }

  deleteSelection() {
    if (this.floating) {
      // The pixels were already lifted out of the frame — just drop them.
      const floating = this.floating;
      this.floating = null;
      this.pushPixelHistory(floating.frame, floating.before, 'delete selection');
      this.selection = null;
      this.afterFrameEdit();
      return;
    }
    if (!this.selection) return;
    const before = this.snapshot(this.frame);
    sel.clearRegion(this.frameCtx, this.selection.bounds, this.selection.mask);
    this.pushPixelHistory(this.frame, before, 'delete selection');
    this.afterFrameEdit();
  }

  pasteClipboard() {
    if (!this.clipboard) {
      this.app.toast('Clipboard is empty.', 'error');
      return;
    }
    this.commitFloating();
    if (this.tool !== 'lasso' && this.tool !== 'stretch') this.setTool('lasso');

    const { canvas, rect, points } = this.clipboard;
    const copy = cloneFrameCanvas(canvas);
    const placed = {
      x: clamp(rect.x, 0, Math.max(0, this.project.width - rect.w)),
      y: clamp(rect.y, 0, Math.max(0, this.project.height - rect.h)),
      w: rect.w,
      h: rect.h
    };
    const shift = { x: placed.x - rect.x, y: placed.y - rect.y };

    this.floating = sel.createFloating({
      canvas: copy,
      rect: placed,
      points: points.map((p) => ({ x: p.x + shift.x, y: p.y + shift.y })),
      origin: placed
    });
    this.floating.before = this.snapshot(this.frame);
    this.floating.frame = this.frame;
    this.floating.pasted = true;
    this.floating.moved = true;
    this.repaint();
    this.app.toast('Pasted — drag to place it, Enter to apply.');
  }

  /** Stretch tool: lift the selection (or the whole frame) ready to scale. */
  beginStretch() {
    if (this.floating) return;
    if (!this.selection) {
      const { width, height } = this.project;
      this.setSelectionFromPoints([
        { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }
      ]);
    }
    this.liftSelection();
    this.repaint();
  }

  /* ---------------------------------------------------------- pointers --- */

  bindStage() {
    this.display.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    window.addEventListener('pointermove', (event) => this.onPointerMove(event));
    window.addEventListener('pointerup', (event) => this.onPointerUp(event));

    this.stageWrap.addEventListener('pointerleave', () => { this.cursorRing.hidden = true; });
    this.stageWrap.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (!this.project) return;
      const anchor = this.toProject(event);
      this.zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, anchor);
    }, { passive: false });

    // Middle- or right-button drag pans the canvas.
    this.stageWrap.addEventListener('pointerdown', (event) => {
      if (event.button === 1 || event.button === 2) {
        event.preventDefault();
        this.drag = { type: 'pan', startX: event.clientX, startY: event.clientY, pan: { ...this.pan } };
        this.stageWrap.classList.add('panning');
      }
    });
    this.stageWrap.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  onPointerDown(event) {
    if (!this.project || this.playing || event.button !== 0 || this.drag) return;

    const point = this.toProject(event);
    this.display.setPointerCapture(event.pointerId);

    switch (this.tool) {
      case 'brush':
      case 'eraser': {
        const ctx = this.strokeLayer.getContext('2d');
        ctx.clearRect(0, 0, this.strokeLayer.width, this.strokeLayer.height);
        this.stroke = {
          builder: new StrokeBuilder(ctx, { size: this.size, color: this.tool === 'eraser' ? '#000000' : this.color }),
          before: this.snapshot(this.frame)
        };
        this.stroke.builder.add(point);
        this.repaint();
        break;
      }
      case 'line': case 'rect': case 'ellipse': case 'triangle': case 'polygon': case 'star': {
        this.stroke = { shapeStart: point, before: this.snapshot(this.frame) };
        this.drawShapePreview(point, event);
        break;
      }
      case 'fill': {
        const before = this.snapshot(this.frame);
        const changed = floodFill(this.frameCtx, point.x, point.y, this.color, {
          tolerance: this.tolerance,
          alpha: this.opacity
        });
        if (changed) {
          this.pushPixelHistory(this.frame, before, 'fill');
          this.afterFrameEdit();
        }
        break;
      }
      case 'eyedropper': {
        const picked = pickColorAt(this.frameCtx, point.x, point.y) || this.project.background;
        if (picked) {
          this.color = normalizeHex(picked);
          this.picker.setColor(this.color, { silent: true });
          this.picker.pushRecent(this.color);
          this.updateSizePreview();
        }
        break;
      }
      case 'lasso': {
        if (this.floating && sel.handleAt(this.floating.rect, point.x, point.y, 6 / this.screenScale) === 'inside') {
          this.drag = { type: 'move-floating', start: point, rect: { ...this.floating.rect } };
          return;
        }
        if (this.selection && !this.floating && sel.maskContains(this.selection, point.x, point.y)) {
          this.liftSelection();
          this.drag = { type: 'move-floating', start: point, rect: { ...this.floating.rect } };
          return;
        }
        this.commitFloating();
        this.selection = null;
        this.drag = { type: 'lasso', points: [point] };
        this.repaint();
        break;
      }
      case 'stretch': {
        if (!this.floating) this.beginStretch();
        if (!this.floating) return;
        const handle = sel.handleAt(this.floating.rect, point.x, point.y, 9 / this.screenScale);
        if (handle && handle !== 'inside') {
          this.drag = { type: 'stretch', handle, rect: { ...this.floating.rect } };
        } else if (handle === 'inside') {
          this.drag = { type: 'move-floating', start: point, rect: { ...this.floating.rect } };
        } else {
          this.commitFloating();
          this.selection = null;
          this.repaint();
        }
        break;
      }
      default:
        break;
    }
  }

  onPointerMove(event) {
    if (!this.project) return;

    if (this.tool === 'brush' || this.tool === 'eraser') this.updateRing(event);

    if (this.app.currentView === 'editor') {
      const point = this.toProject(event);
      $('cursor-pos').textContent = `${Math.round(point.x)}, ${Math.round(point.y)}`;
    }

    if (this.drag && this.drag.type === 'pan') {
      this.pan.x = this.drag.pan.x + (event.clientX - this.drag.startX);
      this.pan.y = this.drag.pan.y + (event.clientY - this.drag.startY);
      this.applyZoom();
      return;
    }

    const point = this.toProject(event);

    if (this.drag && this.drag.type === 'lasso') {
      const last = this.drag.points[this.drag.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) > 1.2 / this.screenScale) {
        this.drag.points.push(point);
        this.repaint();
      }
      return;
    }

    if (this.drag && this.drag.type === 'move-floating') {
      const dx = point.x - this.drag.start.x;
      const dy = point.y - this.drag.start.y;
      this.floating.rect.x = this.drag.rect.x + dx;
      this.floating.rect.y = this.drag.rect.y + dy;
      this.floating.moved = true;
      this.repaint();
      return;
    }

    if (this.drag && this.drag.type === 'stretch') {
      this.floating.rect = sel.stretchRect(this.drag.rect, this.drag.handle, point, {
        keepAspect: event.shiftKey,
        fromCenter: event.altKey
      });
      this.floating.moved = true;
      this.repaint();
      return;
    }

    if (!this.stroke) {
      if (this.tool === 'stretch' && this.floating) {
        const handle = sel.handleAt(this.floating.rect, point.x, point.y, 9 / this.screenScale);
        this.display.style.cursor = handle ? sel.HANDLE_CURSORS[handle] : 'default';
      } else if (this.tool === 'lasso') {
        const inside = this.floating
          ? sel.handleAt(this.floating.rect, point.x, point.y, 0) === 'inside'
          : this.selection && sel.maskContains(this.selection, point.x, point.y);
        this.display.style.cursor = inside ? 'move' : 'crosshair';
      } else {
        this.display.style.cursor = '';
      }
      return;
    }

    if (this.stroke.builder) {
      this.stroke.builder.add(point);
      this.repaint();
    } else if (this.stroke.shapeStart) {
      this.drawShapePreview(point, event);
    }
  }

  onPointerUp(event) {
    if (this.drag && this.drag.type === 'pan') {
      this.drag = null;
      this.stageWrap.classList.remove('panning');
      this.clampPan();
      return;
    }

    if (this.drag && this.drag.type === 'lasso') {
      const points = this.drag.points;
      this.drag = null;
      if (points.length > 3 && this.setSelectionFromPoints(points)) {
        this.app.toast('Selected — drag inside to move, or copy / cut it.');
      } else {
        this.selection = null;
      }
      this.repaint();
      return;
    }

    if (this.drag && (this.drag.type === 'move-floating' || this.drag.type === 'stretch')) {
      this.drag = null;
      this.app.markDirty();
      this.repaint();
      return;
    }

    if (!this.stroke) return;

    if (this.stroke.builder) {
      this.stroke.builder.finish();
      this.commitStrokeLayer();
    } else if (this.stroke.shapeStart) {
      this.commitStrokeLayer();
    }

    const before = this.stroke.before;
    this.stroke = null;
    this.pushPixelHistory(this.frame, before, 'draw');
    this.afterFrameEdit();
  }

  drawShapePreview(point, event) {
    const ctx = this.strokeLayer.getContext('2d');
    ctx.clearRect(0, 0, this.strokeLayer.width, this.strokeLayer.height);
    drawShape(ctx, {
      tool: this.tool,
      start: this.stroke.shapeStart,
      end: point,
      size: this.size,
      color: this.color,
      fill: this.shape.fill,
      fromCenter: this.shape.fromCenter || event.altKey,
      constrain: event.shiftKey,
      sides: this.shape.sides
    });
    this.repaint();
  }

  commitStrokeLayer() {
    const ctx = this.frameCtx;
    ctx.save();
    ctx.globalAlpha = this.opacity;
    if (this.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(this.strokeLayer, 0, 0);
    ctx.restore();
  }

  updateRing(event) {
    const rect = this.stageWrap.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside || this.playing) { this.cursorRing.hidden = true; return; }
    const diameter = Math.max(4, this.size * this.screenScale);
    this.cursorRing.hidden = false;
    this.cursorRing.style.width = `${diameter}px`;
    this.cursorRing.style.height = `${diameter}px`;
    this.cursorRing.style.left = `${event.clientX - rect.left}px`;
    this.cursorRing.style.top = `${event.clientY - rect.top}px`;
  }

  /* ---------------------------------------------------------- history ---- */

  snapshot(frame) {
    return frame.getContext('2d').getImageData(0, 0, frame.width, frame.height);
  }

  pushPixelHistory(frame, before, label) {
    if (!before) return;
    this.history.push({
      label,
      state: { frame, imageData: before },
      capture: () => ({ frame, imageData: this.snapshot(frame) }),
      restore: (state) => {
        state.frame.getContext('2d').putImageData(state.imageData, 0, 0);
        const index = this.project.frames.indexOf(state.frame);
        if (index >= 0 && index !== this.index) this.setFrame(index);
        this.updateThumb(index);
        this.repaint();
        this.repaintOnion();
      }
    });
  }

  captureDoc() {
    return {
      frames: [...this.project.frames],
      index: this.index,
      width: this.project.width,
      height: this.project.height,
      fps: this.project.fps,
      background: this.project.background
    };
  }

  restoreDoc(state) {
    this.project.frames = [...state.frames];
    this.project.width = state.width;
    this.project.height = state.height;
    this.project.fps = state.fps;
    this.project.background = state.background;
    this.index = clamp(state.index, 0, this.project.frames.length - 1);
    this.selection = null;
    this.floating = null;
    this.syncCanvasSize();
    this.syncPanels();
    this.renderTimeline();
    this.repaint();
    this.repaintOnion();
  }

  pushDocHistory(label, before) {
    this.history.push({
      label,
      state: before,
      capture: () => this.captureDoc(),
      restore: (state) => this.restoreDoc(state)
    });
  }

  undo() {
    this.commitFloating();
    if (this.history.undo()) this.app.markDirty();
  }

  redo() {
    this.commitFloating();
    if (this.history.redo()) this.app.markDirty();
  }

  updateHistoryButtons() {
    $('btn-undo').disabled = !this.history.canUndo;
    $('btn-redo').disabled = !this.history.canRedo;
  }

  afterFrameEdit() {
    this.updateThumb(this.index);
    this.repaint();
    this.repaintOnion();
    this.app.markDirty();
  }

  /* ----------------------------------------------------------- frames ---- */

  setFrame(index) {
    const target = clamp(index, 0, this.project.frames.length - 1);
    if (target === this.index && !this.floating) {
      this.updateFrameUI();
      return;
    }
    this.commitFloating();
    this.index = target;
    this.selection = null;
    this.repaint();
    this.repaintOnion();
    this.updateFrameUI();
    this.scrollFrameIntoView();
  }

  addFrame({ copy = false } = {}) {
    const before = this.captureDoc();
    this.commitFloating();
    const frame = copy ? cloneFrameCanvas(this.frame) : createFrameCanvas(this.project.width, this.project.height);
    this.project.frames.splice(this.index + 1, 0, frame);
    this.index += 1;
    this.pushDocHistory(copy ? 'duplicate frame' : 'add frame', before);
    this.renderTimeline();
    this.repaint();
    this.repaintOnion();
    this.app.markDirty();
  }

  deleteFrame() {
    if (this.project.frames.length <= 1) {
      this.app.toast('An animation needs at least one frame.', 'error');
      return;
    }
    const before = this.captureDoc();
    this.commitFloating();
    this.project.frames.splice(this.index, 1);
    this.index = clamp(this.index, 0, this.project.frames.length - 1);
    this.pushDocHistory('delete frame', before);
    this.renderTimeline();
    this.repaint();
    this.repaintOnion();
    this.app.markDirty();
  }

  moveFrame(from, to) {
    if (from === to || to < 0 || to >= this.project.frames.length) return;
    const before = this.captureDoc();
    const [frame] = this.project.frames.splice(from, 1);
    this.project.frames.splice(to, 0, frame);
    this.index = to;
    this.pushDocHistory('reorder frames', before);
    this.renderTimeline();
    this.repaint();
    this.repaintOnion();
    this.app.markDirty();
  }

  clearFrame() {
    const before = this.snapshot(this.frame);
    this.frameCtx.clearRect(0, 0, this.project.width, this.project.height);
    this.pushPixelHistory(this.frame, before, 'clear frame');
    this.afterFrameEdit();
  }

  /* --------------------------------------------------------- timeline ---- */

  renderTimeline() {
    this.strip.innerHTML = '';
    this.thumbs = [];
    this.project.frames.forEach((frame, index) => {
      const item = document.createElement('div');
      item.className = 'frame-item';
      item.draggable = true;
      item.dataset.index = String(index);

      const thumb = document.createElement('canvas');
      const height = 80;
      thumb.height = height;
      thumb.width = Math.max(12, Math.round((this.project.width / this.project.height) * height));
      item.appendChild(thumb);

      const label = document.createElement('span');
      label.className = 'frame-no';
      label.textContent = String(index + 1);
      item.appendChild(label);

      item.addEventListener('click', () => this.setFrame(index));
      item.addEventListener('dragstart', (event) => {
        this.dragFrameIndex = index;
        item.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        for (const el of this.strip.children) el.classList.remove('drop-target');
      });
      item.addEventListener('dragover', (event) => {
        event.preventDefault();
        item.classList.add('drop-target');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
      item.addEventListener('drop', (event) => {
        event.preventDefault();
        item.classList.remove('drop-target');
        const from = Number(event.dataTransfer.getData('text/plain'));
        if (!Number.isNaN(from)) this.moveFrame(from, index);
      });

      this.strip.appendChild(item);
      this.thumbs.push(thumb);
      this.updateThumb(index);
    });
    this.updateFrameUI();
  }

  updateThumb(index) {
    const thumb = this.thumbs[index];
    const frame = this.project.frames[index];
    if (!thumb || !frame) return;
    const ctx = thumb.getContext('2d');
    ctx.clearRect(0, 0, thumb.width, thumb.height);
    ctx.fillStyle = this.project.background || '#FFFFFF';
    ctx.fillRect(0, 0, thumb.width, thumb.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frame, 0, 0, thumb.width, thumb.height);
  }

  refreshThumbs() {
    this.project.frames.forEach((_frame, index) => this.updateThumb(index));
  }

  updateFrameUI() {
    const total = this.project.frames.length;
    $('frame-counter').textContent = `${this.index + 1} / ${total}`;
    $('duration-hint').textContent =
      `${total} frame${total === 1 ? '' : 's'} · ${(total / this.project.fps).toFixed(2)}s at ${this.project.fps} fps`;
    for (const item of this.strip.children) {
      item.classList.toggle('current', Number(item.dataset.index) === this.index);
    }
  }

  scrollFrameIntoView() {
    const item = this.strip.children[this.index];
    if (item) item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* --------------------------------------------------------- playback ---- */

  togglePlay() {
    if (this.playing) this.stop();
    else this.play();
  }

  play() {
    if (this.project.frames.length < 2) {
      this.app.toast('Add another frame to play the animation.', 'error');
      return;
    }
    this.commitFloating();
    this.playing = true;
    $('btn-play').textContent = '⏸';
    this.cursorRing.hidden = true;
    this.repaintOnion();

    const startIndex = this.index;
    const startTime = performance.now();
    const total = this.project.frames.length;

    const tick = (now) => {
      if (!this.playing) return;
      const elapsed = (now - startTime) / 1000;
      const advanced = Math.floor(elapsed * this.project.fps);
      let next = startIndex + advanced;

      if (next >= total) {
        if (!this.loop) { this.setFrameDuringPlayback(total - 1); this.stop(); return; }
        next %= total;
      }
      this.setFrameDuringPlayback(next);
      this.playRaf = requestAnimationFrame(tick);
    };
    this.playRaf = requestAnimationFrame(tick);
  }

  setFrameDuringPlayback(index) {
    if (index === this.index) return;
    this.index = index;
    this.repaint();
    this.updateFrameUI();
  }

  stop() {
    this.playing = false;
    if (this.playRaf) cancelAnimationFrame(this.playRaf);
    $('btn-play').textContent = '▶';
    this.repaintOnion();
    this.repaint();
    this.scrollFrameIntoView();
  }

  /* ----------------------------------------------------------- panels ---- */

  bindTools() {
    const size = $('tool-size');
    const sizeNum = $('tool-size-num');
    size.addEventListener('input', () => this.setSize(size.value));
    sizeNum.addEventListener('change', () => this.setSize(sizeNum.value));

    const opacity = $('tool-opacity');
    opacity.addEventListener('input', () => {
      this.opacity = clamp(Number(opacity.value), 1, 100) / 100;
      $('opacity-value').textContent = `${Math.round(this.opacity * 100)}%`;
      this.updateSizePreview();
    });

    $('shape-fill').addEventListener('change', (event) => { this.shape.fill = event.target.checked; });
    $('shape-center').addEventListener('change', (event) => { this.shape.fromCenter = event.target.checked; });
    $('shape-sides').addEventListener('change', (event) => {
      this.shape.sides = clamp(Math.round(Number(event.target.value) || 5), 3, 20);
      event.target.value = this.shape.sides;
    });

    const tolerance = $('fill-tolerance');
    tolerance.addEventListener('input', () => {
      this.tolerance = Number(tolerance.value);
      $('tolerance-value').textContent = String(this.tolerance);
    });

    $('btn-copy').addEventListener('click', () => this.copySelection());
    $('btn-cut').addEventListener('click', () => this.copySelection({ cut: true }));
    $('btn-paste').addEventListener('click', () => this.pasteClipboard());
    $('btn-delete-selection').addEventListener('click', () => this.deleteSelection());
    $('btn-select-all').addEventListener('click', () => this.selectAll());
    $('btn-deselect').addEventListener('click', () => this.deselect());
  }

  bindPanels() {
    const onionInputs = {
      'onion-enabled': (el) => { this.onion.enabled = el.checked; },
      'onion-before': (el) => { this.onion.before = Number(el.value); $('onion-before-value').textContent = el.value; },
      'onion-after': (el) => { this.onion.after = Number(el.value); $('onion-after-value').textContent = el.value; },
      'onion-opacity': (el) => { this.onion.opacity = Number(el.value) / 100; $('onion-opacity-value').textContent = `${el.value}%`; },
      'onion-falloff': (el) => { this.onion.falloff = Number(el.value) / 100; $('onion-falloff-value').textContent = `${el.value}%`; },
      'onion-tint': (el) => { this.onion.tint = el.checked; },
      'onion-loop': (el) => { this.onion.loop = el.checked; }
    };
    for (const [id, apply] of Object.entries(onionInputs)) {
      const el = $(id);
      el.addEventListener('input', () => { apply(el); this.repaintOnion(); });
      el.addEventListener('change', () => { apply(el); this.repaintOnion(); });
    }

    $('btn-resize').addEventListener('click', () => this.applyResolution());
    $('canvas-bg').addEventListener('change', (event) => {
      if (!isValidHex(event.target.value)) { event.target.value = this.project.background || '#FFFFFF'; return; }
      this.setBackground(normalizeHex(event.target.value));
    });
    $('canvas-bg-transparent').addEventListener('change', (event) => {
      this.setBackground(event.target.checked ? null : normalizeHex($('canvas-bg').value || '#FFFFFF'));
    });

    $('project-fps').addEventListener('change', (event) => {
      this.project.fps = clamp(Math.round(Number(event.target.value) || 24), 1, 60);
      event.target.value = this.project.fps;
      this.updateFrameUI();
      this.app.markDirty();
    });
    $('loop-playback').addEventListener('change', (event) => { this.loop = event.target.checked; });

    $('btn-undo').addEventListener('click', () => this.undo());
    $('btn-redo').addEventListener('click', () => this.redo());
    $('btn-clear-frame').addEventListener('click', () => this.clearFrame());

    $('zoom-in').addEventListener('click', () => this.zoomBy(1.25));
    $('zoom-out').addEventListener('click', () => this.zoomBy(1 / 1.25));
    $('zoom-fit').addEventListener('click', () => this.zoomToFit());

    $('project-name').addEventListener('change', (event) => {
      this.project.name = event.target.value.trim() || 'Untitled';
      event.target.value = this.project.name;
      this.app.markDirty();
      this.app.updateTitle();
    });
  }

  bindTimeline() {
    $('btn-play').addEventListener('click', () => this.togglePlay());
    $('btn-prev').addEventListener('click', () => this.setFrame(this.index - 1));
    $('btn-next').addEventListener('click', () => this.setFrame(this.index + 1));
    $('btn-first').addEventListener('click', () => this.setFrame(0));
    $('btn-last').addEventListener('click', () => this.setFrame(this.project.frames.length - 1));
    $('btn-frame-add').addEventListener('click', () => this.addFrame());
    $('btn-frame-duplicate').addEventListener('click', () => this.addFrame({ copy: true }));
    $('btn-frame-delete').addEventListener('click', () => this.deleteFrame());
  }

  setBackground(hex) {
    const before = this.captureDoc();
    this.project.background = hex;
    this.pushDocHistory('background', before);
    $('canvas-bg').value = hex || '#FFFFFF';
    $('canvas-bg-chip').style.background = hex || 'transparent';
    $('canvas-bg-transparent').checked = !hex;
    this.stage.classList.toggle('solid', Boolean(hex));
    this.stage.style.backgroundColor = hex || '';
    this.refreshThumbs();
    this.app.markDirty();
  }

  applyResolution() {
    const size = clampSize($('canvas-width').value, $('canvas-height').value);
    if (size.width === this.project.width && size.height === this.project.height) return;

    const before = this.captureDoc();
    this.commitFloating();
    const from = { width: this.project.width, height: this.project.height };
    this.project.frames = resizeFrames(this.project.frames, from, size, $('canvas-scale-art').checked);
    this.project.width = size.width;
    this.project.height = size.height;
    this.selection = null;
    this.pushDocHistory('resolution', before);

    this.syncCanvasSize();
    this.zoomToFit();
    this.renderTimeline();
    this.repaint();
    this.repaintOnion();
    this.app.markDirty();
    this.app.toast(`Canvas is now ${size.width} × ${size.height}`);
  }

  syncPanels() {
    $('project-name').value = this.project.name;
    $('project-fps').value = this.project.fps;
    $('canvas-width').value = this.project.width;
    $('canvas-height').value = this.project.height;
    $('canvas-bg').value = this.project.background || '#FFFFFF';
    $('canvas-bg-chip').style.background = this.project.background || 'transparent';
    $('canvas-bg-transparent').checked = !this.project.background;
    $('loop-playback').checked = this.loop;
    $('tool-opacity').value = Math.round(this.opacity * 100);
    $('opacity-value').textContent = `${Math.round(this.opacity * 100)}%`;
    $('fill-tolerance').value = this.tolerance;
    $('tolerance-value').textContent = String(this.tolerance);
    this.setTool(this.tool);
    this.updateHistoryButtons();
    this.updateFrameUI();
  }

  /* --------------------------------------------------------- keyboard ---- */

  bindKeyboard() {
    window.addEventListener('keydown', (event) => {
      if (this.app.currentView !== 'editor') return;
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      // Ctrl/Cmd combinations are owned by the application menu.
      if (event.ctrlKey || event.metaKey) return;

      if (event.code === 'Space') {
        this.togglePlay();
        event.preventDefault();
        return;
      }

      switch (event.key) {
        case ',':
          this.setFrame(this.index - 1);
          event.preventDefault();
          return;
        case '.':
          this.setFrame(this.index + 1);
          event.preventDefault();
          return;
        case 'Escape':
          if (this.floating) this.cancelFloating();
          else if (this.selection) this.deselect();
          event.preventDefault();
          return;
        case 'Enter':
          if (this.floating) { this.commitFloating(); event.preventDefault(); }
          return;
        case 'Delete':
        case 'Backspace':
          if (this.selection || this.floating) { this.deleteSelection(); event.preventDefault(); }
          return;
        case '[':
          this.setSize(this.size - Math.max(1, Math.round(this.size * 0.15)));
          return;
        case ']':
          this.setSize(this.size + Math.max(1, Math.round(this.size * 0.15)));
          return;
        default:
          break;
      }

      const tool = TOOLS.find((entry) => entry.key.toLowerCase() === event.key.toLowerCase());
      if (tool) { this.setTool(tool.id); event.preventDefault(); }
    });

  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
