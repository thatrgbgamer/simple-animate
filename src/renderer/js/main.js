/**
 * Application shell: view routing, project files, menus, toasts.
 */

import { Editor } from './editor.js';
import { ExportView } from './export.js';
import {
  createProject, serializeProject, deserializeProject, RESOLUTION_PRESETS, clampSize
} from './project.js';
import { normalizeHex, isValidHex } from './color.js';

const $ = (id) => document.getElementById(id);
const api = window.simpleAnimate;
const RECENTS_KEY = 'simple-animate.recents';

const SHORTCUTS = {
  'shortcuts-drawing': [
    ['Brush', 'B'], ['Eraser', 'E'], ['Lasso select', 'V'], ['Stretch', 'K'],
    ['Paint bucket', 'G'], ['Eyedropper', 'I'], ['Line', 'L'], ['Rectangle', 'R'],
    ['Ellipse', 'O'], ['Triangle', 'T'], ['Polygon', 'P'], ['Star', 'S'],
    ['Smaller / larger tip', '[  ]'],
    ['Perfect square, circle or 45° line', 'Shift while dragging'],
    ['Draw a shape from its centre', 'Alt while dragging']
  ],
  'shortcuts-frames': [
    ['Previous / next frame', ',  .'],
    ['Play / pause', 'Space'],
    ['Add frame', 'Ctrl/Cmd + →'],
    ['Duplicate frame', 'Ctrl/Cmd + D'],
    ['Delete frame', 'Ctrl/Cmd + Delete'],
    ['Toggle onion skin', 'Ctrl/Cmd + Shift + O'],
    ['Reorder frames', 'Drag a thumbnail']
  ],
  'shortcuts-file': [
    ['New animation', 'Ctrl/Cmd + N'],
    ['Open / Save / Save as', 'Ctrl/Cmd + O / S / Shift+S'],
    ['Export video', 'Ctrl/Cmd + E'],
    ['Undo / redo', 'Ctrl/Cmd + Z / Shift+Z'],
    ['Copy / cut / paste selection', 'Ctrl/Cmd + C / X / V'],
    ['Select all, deselect', 'Ctrl/Cmd + A, Esc'],
    ['Apply a moved or stretched selection', 'Enter'],
    ['Zoom in / out / fit', 'Ctrl/Cmd + + / − / 0'],
    ['Pan the canvas', 'Middle or right mouse drag'],
    ['Zoom with the wheel', 'Scroll over the canvas']
  ]
};

class App {
  constructor() {
    this.currentView = 'home';
    this.previousView = 'home';
    this.project = null;
    this.dirty = false;
    this.editor = new Editor(this);
    this.exportView = new ExportView(this);
  }

  async boot() {
    this.info = await api.info();
    $('home-version').textContent = `v${this.info.version}`;
    $('about-version').textContent = `v${this.info.version}`;
    $('about-runtime').textContent = `Electron ${this.info.electron} · ${platformName(this.info.platform)} · video encoding by ffmpeg`;

    this.buildHome();
    this.buildShortcuts();
    this.editor.mount();
    this.exportView.mount();
    this.bindGlobal();

    api.onMenuCommand((command) => this.handleMenu(command));
    this.goto('home');
    this.renderRecents();
  }

  /* ------------------------------------------------------------ views --- */

  goto(view) {
    if (view === 'back') view = this.previousView === this.currentView ? 'home' : this.previousView;
    if (view === 'editor' && !this.project) view = 'home';
    if (view === 'export' && !this.project) view = 'home';

    if (view !== this.currentView) this.previousView = this.currentView;
    this.currentView = view;

    for (const section of document.querySelectorAll('.view')) {
      section.hidden = section.id !== `view-${view}`;
    }

    if (view === 'editor') {
      this.editor.repaint();
      this.editor.repaintOnion();
      this.editor.clampPan();
    }
    if (view === 'export') this.exportView.open();
    if (view === 'home') this.renderRecents();
    this.updateTitle();
  }

  toast(message, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    $('toast-stack').appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.25s ease';
      setTimeout(() => el.remove(), 260);
    }, kind === 'error' ? 4200 : 2200);
  }

  markDirty() {
    if (!this.dirty) {
      this.dirty = true;
      api.window.setDirty(true);
      this.updateTitle();
    }
  }

  markClean() {
    this.dirty = false;
    api.window.setDirty(false);
    this.updateTitle();
  }

  updateTitle() {
    $('dirty-dot').hidden = !this.dirty;
    const name = this.project ? this.project.name : null;
    api.window.setTitle(name ? `${this.dirty ? '• ' : ''}${name} — Simple Animate` : 'Simple Animate');
  }

  /* --------------------------------------------------------- home view -- */

  buildHome() {
    const presets = $('resolution-presets');
    for (const preset of RESOLUTION_PRESETS) {
      const button = document.createElement('button');
      button.className = 'chip';
      button.textContent = preset.label;
      button.addEventListener('click', () => {
        $('new-width').value = preset.width;
        $('new-height').value = preset.height;
        for (const chip of presets.children) chip.classList.remove('active');
        button.classList.add('active');
      });
      presets.appendChild(button);
    }
    presets.firstChild.classList.add('active');

    const bgInput = $('new-bg');
    const bgChip = $('new-bg-chip');
    const syncBg = () => {
      const transparent = $('new-bg-transparent').checked;
      bgInput.disabled = transparent;
      bgChip.style.background = transparent ? 'transparent' : normalizeHex(bgInput.value, '#FFFFFF');
      bgChip.style.backgroundImage = transparent
        ? 'linear-gradient(45deg,#8a8f99 25%,transparent 25%,transparent 75%,#8a8f99 75%),linear-gradient(45deg,#8a8f99 25%,transparent 25%,transparent 75%,#8a8f99 75%)'
        : 'none';
      bgChip.style.backgroundSize = '10px 10px';
      bgChip.style.backgroundPosition = '0 0, 5px 5px';
    };
    bgInput.addEventListener('input', syncBg);
    $('new-bg-transparent').addEventListener('change', syncBg);

    for (const hex of ['#FFFFFF', '#000000', '#1E2430', '#F4F1EA', '#7ECBFF']) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.style.background = hex;
      swatch.title = hex;
      swatch.addEventListener('click', () => {
        $('new-bg-transparent').checked = false;
        bgInput.value = hex;
        syncBg();
      });
      $('new-bg-swatches').appendChild(swatch);
    }
    syncBg();

    $('btn-create').addEventListener('click', () => this.createProject());
    $('btn-open').addEventListener('click', () => this.openProject());
    $('new-name').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.createProject();
    });
  }

  buildShortcuts() {
    for (const [id, rows] of Object.entries(SHORTCUTS)) {
      const list = $(id);
      list.innerHTML = '';
      for (const [label, keys] of rows) {
        const item = document.createElement('li');
        item.innerHTML = `<span>${label}</span><span>${keys.split(' ').map((k) => `<kbd>${k}</kbd>`).join(' ')}</span>`;
        list.appendChild(item);
      }
    }
  }

  renderRecents() {
    const list = $('recent-list');
    const recents = this.getRecents();
    list.innerHTML = '';
    $('recent-empty').hidden = recents.length > 0;

    for (const entry of recents) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.innerHTML = `<span class="recent-name"></span><span class="recent-path"></span>`;
      button.querySelector('.recent-name').textContent = entry.name;
      button.querySelector('.recent-path').textContent = entry.path;
      button.title = entry.path;
      button.addEventListener('click', () => this.openProject(entry.path));
      item.appendChild(button);
      list.appendChild(item);
    }
  }

  getRecents() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((entry) => entry && entry.path).slice(0, 8) : [];
    } catch (err) {
      return [];
    }
  }

  rememberRecent(path, name) {
    if (!path) return;
    const next = [{ path, name, at: Date.now() }, ...this.getRecents().filter((entry) => entry.path !== path)].slice(0, 8);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch (err) { /* storage is optional */ }
  }

  /* ------------------------------------------------------- project i/o -- */

  async confirmDiscard() {
    if (!this.dirty) return true;
    const response = await api.messageBox({
      type: 'warning',
      message: 'Save your animation first?',
      detail: 'You have unsaved changes.',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2
    });
    if (response === 2) return false;
    if (response === 0) return this.save();
    return true;
  }

  async createProject() {
    if (!(await this.confirmDiscard())) return;

    const size = clampSize($('new-width').value, $('new-height').value);
    const transparent = $('new-bg-transparent').checked;
    const background = transparent ? null : normalizeHex($('new-bg').value, '#FFFFFF');

    this.setProject(createProject({
      name: $('new-name').value.trim() || 'My Animation',
      width: size.width,
      height: size.height,
      fps: Math.max(1, Math.min(60, Math.round(Number($('new-fps').value) || 24))),
      background
    }));
    this.markClean();
    this.goto('editor');
    this.editor.zoomToFit();
  }

  setProject(project) {
    this.project = project;
    this.editor.setProject(project);
    this.updateTitle();
  }

  async openProject(path = null) {
    if (!(await this.confirmDiscard())) return;
    try {
      const result = path ? await api.project.read(path) : await api.project.openDialog();
      if (!result) return;
      const project = await deserializeProject(result.json, result.filePath);
      this.setProject(project);
      this.markClean();
      this.rememberRecent(result.filePath, project.name);
      this.goto('editor');
      this.editor.zoomToFit();
      this.toast(`Opened ${project.name}`, 'success');
    } catch (error) {
      this.toast(cleanMessage(error), 'error');
    }
  }

  async save({ saveAs = false } = {}) {
    if (!this.project) return false;
    this.editor.commitFloating();

    let path = this.project.filePath;
    if (!path || saveAs) {
      path = await api.project.saveDialog(this.project.name);
      if (!path) return false;
    }

    try {
      await api.project.write(path, serializeProject(this.project));
      this.project.filePath = path;
      this.rememberRecent(path, this.project.name);
      this.markClean();
      this.toast('Saved', 'success');
      return true;
    } catch (error) {
      this.toast(cleanMessage(error), 'error');
      return false;
    }
  }

  /* ----------------------------------------------------------- global --- */

  bindGlobal() {
    document.addEventListener('click', (event) => {
      const siteButton = event.target.closest('[data-site-link]');
      if (siteButton) {
        api.openSite(this.info ? this.info.siteUrl : undefined);
        return;
      }
      const goto = event.target.closest('[data-goto]');
      if (goto) this.goto(goto.dataset.goto);
    });

    $('btn-save').addEventListener('click', () => this.save());
    $('btn-export').addEventListener('click', () => this.goto('export'));

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && (this.currentView === 'shortcuts' || this.currentView === 'about')) {
        this.goto('back');
      }
    });

    // The renderer never navigates away from the app shell.
    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', (event) => event.preventDefault());
  }

  async handleMenu(command) {
    const editor = this.editor;
    const inEditor = this.currentView === 'editor' && this.project;

    switch (command) {
      case 'new': this.goto('home'); $('new-name').focus(); return;
      case 'open': return void this.openProject();
      case 'save': return void this.save();
      case 'save-as': return void this.save({ saveAs: true });
      case 'save-and-close': {
        const saved = await this.save();
        if (saved) api.window.forceClose();
        return;
      }
      case 'export': if (this.project) this.goto('export'); return;
      case 'about': this.goto('about'); return;
      case 'shortcuts': this.goto('shortcuts'); return;
      default: break;
    }

    if (!inEditor) return;

    switch (command) {
      case 'undo': editor.undo(); break;
      case 'redo': editor.redo(); break;
      case 'copy': this.editOrDocument('copy', () => editor.copySelection()); break;
      case 'cut': this.editOrDocument('cut', () => editor.copySelection({ cut: true })); break;
      case 'paste': this.editOrDocument('paste', () => editor.pasteClipboard()); break;
      case 'select-all': this.editOrDocument('selectAll', () => editor.selectAll()); break;
      case 'deselect': editor.deselect(); break;
      case 'clear-frame': editor.clearFrame(); break;
      case 'resize': $('canvas-width').focus(); $('canvas-width').select(); break;
      case 'frame-add': editor.addFrame(); break;
      case 'frame-duplicate': editor.addFrame({ copy: true }); break;
      case 'frame-delete': editor.deleteFrame(); break;
      case 'frame-prev': editor.setFrame(editor.index - 1); break;
      case 'frame-next': editor.setFrame(editor.index + 1); break;
      case 'play-toggle': editor.togglePlay(); break;
      case 'onion-toggle': {
        const toggle = $('onion-enabled');
        toggle.checked = !toggle.checked;
        toggle.dispatchEvent(new Event('change'));
        break;
      }
      case 'zoom-in': editor.zoomBy(1.25); break;
      case 'zoom-out': editor.zoomBy(1 / 1.25); break;
      case 'zoom-fit': editor.zoomToFit(); break;
      default: break;
    }
  }

  /** Text fields keep their normal clipboard behaviour. */
  editOrDocument(role, canvasAction) {
    const active = document.activeElement;
    const isTextField = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (isTextField) {
      if (role === 'selectAll') active.select();
      else document.execCommand(role);
      return;
    }
    canvasAction();
  }
}

function platformName(platform) {
  return platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';
}

function cleanMessage(error) {
  return String(error && error.message ? error.message : error).replace(/^Error:\s*/, '');
}

const app = new App();
window.app = app;
app.boot().catch((error) => {
  document.body.innerHTML = `<pre style="padding:24px;color:#ff8f9a;white-space:pre-wrap">Simple Animate failed to start:\n\n${cleanMessage(error)}</pre>`;
});
