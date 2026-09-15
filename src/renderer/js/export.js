/**
 * Export view: renders every frame to PNG and pipes it through ffmpeg in the
 * main process.
 */

import { createFrameCanvas } from './project.js';

const $ = (id) => document.getElementById(id);

export const EXPORT_FORMATS = [
  {
    id: 'prores-hq',
    name: 'QuickTime ProRes 422 HQ',
    extension: 'mov',
    tag: 'Best quality',
    alpha: false,
    description: 'A 10-bit mastering file. Much larger than MP4, but keeps every detail of your line art — the right pick for editing or archiving.'
  },
  {
    id: 'prores-4444',
    name: 'QuickTime ProRes 4444 + alpha',
    extension: 'mov',
    tag: 'Transparent',
    alpha: true,
    description: 'ProRes with a real alpha channel, so a transparent background stays transparent when you drop it over other footage.'
  },
  {
    id: 'h264',
    name: 'MP4 (H.264, CRF 12)',
    extension: 'mp4',
    tag: 'Shareable',
    alpha: false,
    description: 'Near-lossless MP4 that plays anywhere — phones, browsers, social apps. Far smaller than ProRes.'
  },
  {
    id: 'png-sequence',
    name: 'PNG sequence',
    extension: '',
    tag: 'Frames',
    alpha: true,
    description: 'One lossless PNG per frame in a folder, numbered for import into any other editor.'
  }
];

export class ExportView {
  constructor(app) {
    this.app = app;
    this.format = 'prores-hq';
    this.outputPath = null;
    this.running = false;
    this.jobId = null;
    this.canceled = false;
  }

  mount() {
    this.buildFormatList();

    $('btn-choose-path').addEventListener('click', () => this.choosePath());
    $('btn-run-export').addEventListener('click', () => this.run());
    $('btn-cancel-export').addEventListener('click', () => this.cancel());
    $('btn-reveal').addEventListener('click', () => {
      if (this.lastOutput) window.simpleAnimate.revealInFolder(this.lastOutput);
    });

    const width = $('export-width');
    const height = $('export-height');
    width.addEventListener('change', () => this.syncAspect('width'));
    height.addEventListener('change', () => this.syncAspect('height'));
    $('export-fps').addEventListener('change', () => this.updateSummary());
    $('export-transparent').addEventListener('change', () => this.updateSummary());

    for (const button of document.querySelectorAll('[data-scale]')) {
      button.addEventListener('click', () => {
        const scale = Number(button.dataset.scale);
        const project = this.app.project;
        width.value = evenClamp(project.width * scale);
        height.value = evenClamp(project.height * scale);
        this.updateSummary();
      });
    }
  }

  buildFormatList() {
    const list = $('format-list');
    list.innerHTML = '';
    for (const format of EXPORT_FORMATS) {
      const option = document.createElement('label');
      option.className = 'format-option';
      option.dataset.format = format.id;
      option.innerHTML = `
        <input type="radio" name="export-format" value="${format.id}" />
        <div>
          <div class="format-title">${format.name}
            <span class="tag ${format.alpha ? 'alpha' : ''}">${format.tag}</span>
          </div>
          <div class="format-desc">${format.description}</div>
        </div>`;
      option.querySelector('input').addEventListener('change', () => this.setFormat(format.id));
      list.appendChild(option);
    }
  }

  setFormat(id) {
    this.format = id;
    const format = EXPORT_FORMATS.find((entry) => entry.id === id);
    for (const option of document.querySelectorAll('.format-option')) {
      const selected = option.dataset.format === id;
      option.classList.toggle('selected', selected);
      option.querySelector('input').checked = selected;
    }

    const transparent = $('export-transparent');
    transparent.disabled = !format.alpha;
    if (!format.alpha) transparent.checked = false;
    else if (!this.app.project.background) transparent.checked = true;

    // A path chosen for another container no longer applies.
    if (this.outputPath && format.extension && !this.outputPath.toLowerCase().endsWith('.' + format.extension)) {
      this.outputPath = null;
      $('export-path').value = '';
    }
    this.updateSummary();
  }

  /** Called every time the view opens. */
  open() {
    const project = this.app.project;
    $('export-width').value = evenClamp(project.width);
    $('export-height').value = evenClamp(project.height);
    $('export-fps').value = project.fps;
    $('export-error').hidden = true;
    $('export-progress').hidden = true;
    $('btn-reveal').hidden = !this.lastOutput;
    this.setFormat(this.format);
  }

  syncAspect(changed) {
    const project = this.app.project;
    const width = $('export-width');
    const height = $('export-height');
    if ($('export-link-aspect').checked) {
      const ratio = project.width / project.height;
      if (changed === 'width') height.value = evenClamp(Number(width.value) / ratio);
      else width.value = evenClamp(Number(height.value) * ratio);
    }
    width.value = evenClamp(width.value);
    height.value = evenClamp(height.value);
    this.updateSummary();
  }

  get settings() {
    const project = this.app.project;
    const format = EXPORT_FORMATS.find((entry) => entry.id === this.format);
    return {
      format,
      width: evenClamp($('export-width').value || project.width),
      height: evenClamp($('export-height').value || project.height),
      fps: Math.max(1, Math.min(60, Math.round(Number($('export-fps').value) || project.fps))),
      transparent: $('export-transparent').checked && format.alpha
    };
  }

  updateSummary() {
    const project = this.app.project;
    if (!project) return;
    const { format, width, height, fps, transparent } = this.settings;
    const frames = project.frames.length;
    const seconds = frames / fps;
    const background = transparent ? 'transparent background' : `${project.background || 'white'} background`;
    $('export-summary').textContent =
      `${frames} frame${frames === 1 ? '' : 's'} · ${seconds.toFixed(2)}s · ${width} × ${height} at ${fps} fps · ` +
      `${format.extension ? '.' + format.extension : 'PNG folder'} · ${background}`;
  }

  async choosePath() {
    const { format } = this.settings;
    const path = await window.simpleAnimate.exporter.choosePath({
      format: format.id,
      extension: format.extension,
      defaultName: this.app.project.name
    });
    if (!path) return null;
    this.outputPath = path;
    $('export-path').value = path;
    return path;
  }

  setProgress(done, total, label) {
    $('export-progress').hidden = false;
    const percent = total ? Math.round((done / total) * 100) : 0;
    $('export-progress-fill').style.width = `${percent}%`;
    $('export-progress-text').textContent = label || `Rendering frame ${done} of ${total}…`;
  }

  showError(message) {
    const el = $('export-error');
    el.hidden = false;
    el.textContent = message;
  }

  async run() {
    if (this.running) return;
    const project = this.app.project;
    if (!project) return;

    let path = this.outputPath;
    if (!path) path = await this.choosePath();
    if (!path) return;

    const { format, width, height, fps, transparent } = this.settings;
    const background = transparent ? null : (project.background || '#FFFFFF');

    this.running = true;
    this.canceled = false;
    $('export-error').hidden = true;
    $('btn-reveal').hidden = true;
    $('btn-run-export').disabled = true;
    $('btn-cancel-export').hidden = false;
    this.setProgress(0, project.frames.length, 'Starting encoder…');

    const canvas = createFrameCanvas(width, height);
    const ctx = canvas.getContext('2d');

    try {
      const job = await window.simpleAnimate.exporter.start({
        format: format.id,
        fps,
        outputPath: path
      });
      this.jobId = job.id;

      for (let i = 0; i < project.frames.length; i++) {
        if (this.canceled) throw new Error('Export canceled.');

        ctx.clearRect(0, 0, width, height);
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(project.frames[i], 0, 0, width, height);

        const buffer = await canvasToPngBuffer(canvas);
        await window.simpleAnimate.exporter.frame(this.jobId, buffer);
        this.setProgress(i + 1, project.frames.length);
      }

      this.setProgress(project.frames.length, project.frames.length, 'Finishing the file…');
      const result = await window.simpleAnimate.exporter.finish(this.jobId);
      this.jobId = null;
      this.lastOutput = result.outputPath;

      this.setProgress(1, 1, `Done — ${result.frames} frames written.`);
      $('btn-reveal').hidden = false;
      this.app.toast('Export finished', 'success');
    } catch (error) {
      if (this.jobId) {
        window.simpleAnimate.exporter.cancel(this.jobId);
        this.jobId = null;
      }
      $('export-progress').hidden = true;
      if (!this.canceled) {
        this.showError(String(error && error.message ? error.message : error).replace(/^Error: /, ''));
        this.app.toast('Export failed', 'error');
      }
    } finally {
      this.running = false;
      $('btn-run-export').disabled = false;
      $('btn-cancel-export').hidden = true;
    }
  }

  cancel() {
    if (!this.running) return;
    this.canceled = true;
    if (this.jobId) window.simpleAnimate.exporter.cancel(this.jobId);
    this.app.toast('Export canceled');
  }
}

function canvasToPngBuffer(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('The frame could not be encoded as PNG.')); return; }
      blob.arrayBuffer().then(resolve, reject);
    }, 'image/png');
  });
}

/** Video encoders want even dimensions; keep the UI honest about it. */
function evenClamp(value) {
  const rounded = Math.round(Number(value) || 0);
  const clamped = Math.max(16, Math.min(7680, rounded));
  return clamped % 2 === 0 ? clamped : clamped - 1;
}
