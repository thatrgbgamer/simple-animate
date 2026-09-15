/**
 * The document model: a list of raster frames plus canvas settings.
 * Every frame is a plain <canvas> the size of the project.
 */

export const FILE_FORMAT = 'simple-animate';
export const FILE_VERSION = 1;

export const RESOLUTION_PRESETS = [
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: '1280 × 720', width: 1280, height: 720 },
  { label: '1080 × 1080', width: 1080, height: 1080 },
  { label: '1080 × 1920', width: 1080, height: 1920 },
  { label: '3840 × 2160', width: 3840, height: 2160 },
  { label: '854 × 480', width: 854, height: 480 }
];

export const MAX_WIDTH = 7680;
export const MAX_HEIGHT = 4320;

export function createFrameCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function cloneFrameCanvas(source) {
  const copy = createFrameCanvas(source.width, source.height);
  copy.getContext('2d').drawImage(source, 0, 0);
  return copy;
}

export function clampSize(width, height) {
  return {
    width: Math.max(16, Math.min(MAX_WIDTH, Math.round(Number(width) || 16))),
    height: Math.max(16, Math.min(MAX_HEIGHT, Math.round(Number(height) || 16)))
  };
}

export function createProject({ name = 'My Animation', width = 1920, height = 1080, fps = 24, background = '#FFFFFF' } = {}) {
  const size = clampSize(width, height);
  return {
    name,
    width: size.width,
    height: size.height,
    fps: Math.max(1, Math.min(60, Math.round(fps) || 24)),
    background, // hex string, or null for transparent
    frames: [createFrameCanvas(size.width, size.height)],
    filePath: null
  };
}

export function frameDuration(project) {
  return project.frames.length / project.fps;
}

/** Serialise to the .sanim JSON we write to disk. */
export function serializeProject(project) {
  return JSON.stringify({
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name: project.name,
    width: project.width,
    height: project.height,
    fps: project.fps,
    background: project.background,
    frames: project.frames.map((frame) => frame.toDataURL('image/png'))
  });
}

export async function deserializeProject(json, filePath = null) {
  let data;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error('That file is not a Simple Animate project (invalid JSON).');
  }

  if (!data || data.format !== FILE_FORMAT || !Array.isArray(data.frames)) {
    throw new Error('That file is not a Simple Animate project.');
  }
  if (data.version > FILE_VERSION) {
    throw new Error('This project was made with a newer version of Simple Animate.');
  }

  const size = clampSize(data.width, data.height);
  const frames = await Promise.all(
    data.frames.map((dataUrl) => loadFrame(dataUrl, size.width, size.height))
  );

  return {
    name: typeof data.name === 'string' && data.name.trim() ? data.name : 'Untitled',
    width: size.width,
    height: size.height,
    fps: Math.max(1, Math.min(60, Math.round(data.fps) || 24)),
    background: typeof data.background === 'string' ? data.background : null,
    frames: frames.length ? frames : [createFrameCanvas(size.width, size.height)],
    filePath
  };
}

function loadFrame(dataUrl, width, height) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = createFrameCanvas(width, height);
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error('A frame in this project could not be read.'));
    image.src = dataUrl;
  });
}

/**
 * Returns a fresh set of frame canvases at the new size. When scaleArt is
 * false the artwork keeps its pixel size and is centred in the new canvas.
 */
export function resizeFrames(frames, from, to, scaleArt) {
  return frames.map((frame) => {
    const canvas = createFrameCanvas(to.width, to.height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (scaleArt) {
      const scale = Math.min(to.width / from.width, to.height / from.height);
      const w = from.width * scale;
      const h = from.height * scale;
      ctx.drawImage(frame, (to.width - w) / 2, (to.height - h) / 2, w, h);
    } else {
      ctx.drawImage(frame, (to.width - from.width) / 2, (to.height - from.height) / 2);
    }
    return canvas;
  });
}

/** Draws one frame onto a target context, optionally over a background. */
export function compositeFrame(ctx, frame, { width, height, background = null }) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(frame, 0, 0, width, height);
  ctx.restore();
}
