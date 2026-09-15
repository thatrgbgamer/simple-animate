'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolveFfmpegPath } = require('./ffmpeg-path');

/**
 * Encoder presets. The renderer sends lossless PNG frames down a pipe, so the
 * only quality loss is whatever the chosen codec introduces.
 *
 *  - prores-hq   ProRes 422 HQ, the best quality/size trade for a .mov master
 *  - prores-4444 ProRes 4444 with a real alpha channel (transparent export)
 *  - h264        near-transparent CRF 12 H.264 .mp4 for sharing anywhere
 */
const FORMATS = {
  'prores-hq': {
    extension: 'mov',
    alpha: false,
    args: () => [
      '-c:v', 'prores_ks',
      '-profile:v', '3',
      '-vendor', 'apl0',
      '-pix_fmt', 'yuv422p10le',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
    ]
  },
  'prores-4444': {
    extension: 'mov',
    alpha: true,
    args: () => [
      '-c:v', 'prores_ks',
      '-profile:v', '4',
      '-vendor', 'apl0',
      '-pix_fmt', 'yuva444p10le',
      '-alpha_bits', '16',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
    ]
  },
  'h264': {
    extension: 'mp4',
    alpha: false,
    args: () => [
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '12',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
    ]
  },
  'png-sequence': {
    extension: '',
    alpha: true,
    args: () => []
  }
};

let nextJobId = 1;
const jobs = new Map();

class ExportJob {
  constructor({ format, fps, outputPath, onEvent }) {
    this.id = String(nextJobId++);
    this.format = format;
    this.fps = fps;
    this.outputPath = outputPath;
    this.onEvent = onEvent;
    this.framesWritten = 0;
    this.stderr = '';
    this.failure = null;
    this.finished = false;
    this.canceled = false;
    this.child = null;
  }

  start() {
    if (this.format === 'png-sequence') {
      fs.mkdirSync(this.outputPath, { recursive: true });
      return;
    }

    const ffmpeg = resolveFfmpegPath();
    if (!ffmpeg) {
      throw new Error(
        'The bundled ffmpeg binary could not be found. Reinstall Simple Animate, or run "npm install" if you are running from source.'
      );
    }

    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });

    const preset = FORMATS[this.format];
    const args = [
      '-y',
      '-f', 'image2pipe',
      '-c:v', 'png',
      '-framerate', String(this.fps),
      '-i', 'pipe:0',
      '-an',
      '-r', String(this.fps),
      ...preset.args(),
      this.outputPath
    ];

    this.child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });

    this.child.stderr.on('data', (chunk) => {
      // Keep a rolling tail so a failure message is available without holding
      // on to megabytes of encoder chatter.
      this.stderr = (this.stderr + chunk.toString()).slice(-8000);
    });

    this.child.on('error', (err) => {
      this.failure = this.failure || err;
      this.emit('error', { message: err.message });
    });

    this.child.stdin.on('error', (err) => {
      // EPIPE simply means ffmpeg exited early; the close handler reports why.
      if (err.code !== 'EPIPE') this.failure = this.failure || err;
    });

    this.exited = new Promise((resolve) => {
      this.child.on('close', (code, signal) => resolve({ code, signal }));
    });
  }

  emit(type, payload) {
    if (this.onEvent) this.onEvent({ id: this.id, type, ...payload });
  }

  async writeFrame(buffer) {
    if (this.canceled) throw new Error('Export canceled.');

    if (this.format === 'png-sequence') {
      const name = String(this.framesWritten + 1).padStart(5, '0') + '.png';
      await fs.promises.writeFile(path.join(this.outputPath, name), buffer);
      this.framesWritten++;
      return { framesWritten: this.framesWritten };
    }

    if (!this.child || this.child.exitCode !== null) {
      throw new Error(this.describeFailure('ffmpeg stopped before all frames were written.'));
    }

    await new Promise((resolve, reject) => {
      const ok = this.child.stdin.write(buffer, (err) => {
        if (err && err.code !== 'EPIPE') reject(err);
      });
      if (ok) resolve();
      else this.child.stdin.once('drain', resolve);
    });

    this.framesWritten++;
    return { framesWritten: this.framesWritten };
  }

  async finish() {
    if (this.format === 'png-sequence') {
      this.finished = true;
      return { outputPath: this.outputPath, frames: this.framesWritten };
    }

    if (!this.child) throw new Error('Export was never started.');

    await new Promise((resolve) => this.child.stdin.end(resolve));
    const { code, signal } = await this.exited;
    this.finished = true;

    if (this.canceled) throw new Error('Export canceled.');
    if (code !== 0) {
      throw new Error(
        this.describeFailure(`ffmpeg exited with code ${code === null ? signal : code}.`)
      );
    }

    return { outputPath: this.outputPath, frames: this.framesWritten };
  }

  describeFailure(prefix) {
    const tail = this.stderr
      .split('\n')
      .filter((line) => line.trim())
      .slice(-6)
      .join('\n');
    const base = this.failure ? `${prefix} ${this.failure.message}` : prefix;
    return tail ? `${base}\n\n${tail}` : base;
  }

  cancel() {
    this.canceled = true;
    if (this.child && this.child.exitCode === null) {
      try {
        this.child.stdin.destroy();
      } catch (err) { /* already gone */ }
      this.child.kill('SIGKILL');
    }
    if (this.format !== 'png-sequence' && this.outputPath) {
      // Remove the half written file so a canceled export leaves nothing behind.
      fs.promises.rm(this.outputPath, { force: true }).catch(() => {});
    }
  }
}

function startExport(options, onEvent) {
  const preset = FORMATS[options.format];
  if (!preset) throw new Error(`Unknown export format: ${options.format}`);

  const fps = Math.max(1, Math.min(120, Math.round(Number(options.fps) || 24)));
  const job = new ExportJob({
    format: options.format,
    fps,
    outputPath: options.outputPath,
    onEvent
  });
  job.start();
  jobs.set(job.id, job);
  return { id: job.id, alpha: preset.alpha, fps };
}

function getJob(id) {
  const job = jobs.get(id);
  if (!job) throw new Error('That export is no longer running.');
  return job;
}

async function writeFrame(id, buffer) {
  return getJob(id).writeFrame(Buffer.from(buffer));
}

async function finishExport(id) {
  const job = getJob(id);
  try {
    return await job.finish();
  } finally {
    jobs.delete(id);
  }
}

function cancelExport(id) {
  const job = jobs.get(id);
  if (job) {
    job.cancel();
    jobs.delete(id);
  }
  return { canceled: true };
}

function cancelAll() {
  for (const job of jobs.values()) job.cancel();
  jobs.clear();
}

module.exports = { FORMATS, startExport, writeFrame, finishExport, cancelExport, cancelAll };
