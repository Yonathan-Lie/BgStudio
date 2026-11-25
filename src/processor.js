/**
 * Pure, dependency-free image background removal and color compositing engine.
 * Operates on raw RGBA Uint8ClampedArray buffers and Uint8Array alpha masks.
 */

const MAX_REDMEAN_DIST = 764.8333151739665;

/**
 * Perceptual weighted RGB distance (Redmean), normalized to [0, 100].
 */
export function colorDistance(r1, g1, b1, r2, g2, b2) {
  const rMean = (r1 + r2) * 0.5;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  const wR = 2 + rMean / 256;
  const wG = 4;
  const wB = 2 + (255 - rMean) / 256;
  const dist = Math.sqrt(wR * dr * dr + wG * dg * dg + wB * db * db);
  return (dist / MAX_REDMEAN_DIST) * 100;
}

/**
 * Chroma-aware backdrop distance: combines Redmean perceptual distance with
 * chrominance difference so neutral gray anti-aliased edges stay close to white
 * while warm skin highlights (e.g. ears) have a larger distance and stay protected.
 */
export function backdropDistance(r1, g1, b1, r2, g2, b2) {
  const rm = colorDistance(r1, g1, b1, r2, g2, b2);
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  const dRG = dr - dg;
  const dGB = dg - db;
  const dRB = dr - db;
  const chroma = (Math.sqrt(dRG * dRG + dGB * dGB + dRB * dRB) / (255 * Math.SQRT2)) * 100;
  return 0.65 * rm + 0.85 * chroma;
}

/**
 * Parse a hex color string (#RRGGBB or #RGB) into [r, g, b].
 */
export function hexToRgb(hex) {
  let clean = String(hex).trim().replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  const num = parseInt(clean, 16);
  if (Number.isNaN(num) || clean.length !== 6) {
    return [255, 255, 255];
  }
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Convert [r, g, b] to #rrggbb hex string.
 */
export function rgbToHex(r, g, b) {
  const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Detect the dominant background color by sampling the outer border pixels
 * and finding the most frequent quantized color bucket (5-bit per channel).
 * Using the mode instead of the mean prevents subjects touching the bottom edge
 * (e.g. suits in ID photos) from skewing the detected backdrop color.
 */
export function detectBorderColor(data, width, height) {
  const buckets = new Map();
  const step = Math.max(1, Math.floor(Math.min(width, height) / 200));

  const samplePixel = (x, y) => {
    const idx = (y * width + x) * 4;
    if (data[idx + 3] < 128) return;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let entry = buckets.get(key);
    if (!entry) {
      entry = { count: 0, rSum: 0, gSum: 0, bSum: 0 };
      buckets.set(key, entry);
    }
    entry.count++;
    entry.rSum += r;
    entry.gSum += g;
    entry.bSum += b;
  };

  for (let x = 0; x < width; x += step) {
    samplePixel(x, 0);
    if (height > 1) samplePixel(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += step) {
    samplePixel(0, y);
    if (width > 1) samplePixel(width - 1, y);
  }

  let best = null;
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) {
      best = entry;
    }
  }

  if (!best) return [255, 255, 255];
  return [
    Math.round(best.rSum / best.count),
    Math.round(best.gSum / best.count),
    Math.round(best.bSum / best.count),
  ];
}

function smoothstepAlpha(dist, tolerance, softness) {
  if (dist <= tolerance) return 0;
  if (softness <= 0 || dist >= tolerance + softness) return 255;
  const t = (dist - tolerance) / softness;
  const smooth = t * t * (3 - 2 * t);
  return Math.round(smooth * 255);
}

/**
 * Perform boundary-band vector-projection alpha matting around the flooded background.
 * Estimates partial alpha for anti-aliased & JPEG-ringed boundary pixels (e.g. hair)
 * using the local interior foreground color without expanding the flood fill into skin.
 */
function applyBoundaryMatting(data, mask, width, height, targetColor, tolerance, softness) {
  const bandWidth = Math.max(1, Math.min(5, Math.round(softness / 4.5)));
  const total = width * height;
  const bandDist = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < total; i++) {
    if (mask[i] !== 0) continue;
    const x = i % width;
    const y = (i - x) / width;

    const pushIfFg = (ni) => {
      if (mask[ni] === 255 && bandDist[ni] === 0) {
        bandDist[ni] = 1;
        queue[tail++] = ni;
      }
    };

    if (x > 0) pushIfFg(i - 1);
    if (x < width - 1) pushIfFg(i + 1);
    if (y > 0) pushIfFg(i - width);
    if (y < height - 1) pushIfFg(i + width);
  }

  while (head < tail) {
    const idx = queue[head++];
    const d = bandDist[idx];
    if (d >= bandWidth) continue;

    const x = idx % width;
    const y = (idx - x) / width;
    const nextD = d + 1;

    const pushNext = (ni) => {
      if (mask[ni] === 255 && bandDist[ni] === 0) {
        bandDist[ni] = nextD;
        queue[tail++] = ni;
      }
    };

    if (x > 0) pushNext(idx - 1);
    if (x < width - 1) pushNext(idx + 1);
    if (y > 0) pushNext(idx - width);
    if (y < height - 1) pushNext(idx + width);
  }

  if (tail === 0) return;

  const fgRef = new Int32Array(total);
  fgRef.fill(-1);
  const refQueue = new Int32Array(total);
  let refHead = 0;
  let refTail = 0;

  for (let k = 0; k < tail; k++) {
    const idx = queue[k];
    const x = idx % width;
    const y = (idx - x) / width;
    const checkInterior = (ni) => {
      if (mask[ni] === 255 && bandDist[ni] === 0 && fgRef[idx] === -1) {
        fgRef[idx] = ni;
        refQueue[refTail++] = idx;
      }
    };
    if (x > 0) checkInterior(idx - 1);
    if (x < width - 1) checkInterior(idx + 1);
    if (y > 0) checkInterior(idx - width);
    if (y < height - 1) checkInterior(idx + width);
  }

  while (refHead < refTail) {
    const idx = refQueue[refHead++];
    const ref = fgRef[idx];
    const x = idx % width;
    const y = (idx - x) / width;
    const spread = (ni) => {
      if (bandDist[ni] > 0 && fgRef[ni] === -1) {
        fgRef[ni] = ref;
        refQueue[refTail++] = ni;
      }
    };
    if (x > 0) spread(idx - 1);
    if (x < width - 1) spread(idx + 1);
    if (y > 0) spread(idx - width);
    if (y < height - 1) spread(idx + width);
  }

  const [bgR, bgG, bgB] = targetColor;
  const outerThreshold = tolerance + softness * 1.15;

  for (let k = 0; k < tail; k++) {
    const idx = queue[k];
    let ref = fgRef[idx];

    // Fallback for thin strands or small images where no bandDist===0 pixel is adjacent
    if (ref === -1) {
      const cx = idx % width;
      const cy = (idx - cx) / width;
      let bestDist2 = -1;
      for (let dy = -2; dy <= 2; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          if (nx < 0 || nx >= width) continue;
          const ni = ny * width + nx;
          if (mask[ni] !== 255) continue;
          const np = ni * 4;
          const dr = data[np] - bgR;
          const dg = data[np + 1] - bgG;
          const db = data[np + 2] - bgB;
          const d2 = dr * dr + dg * dg + db * db;
          if (d2 > bestDist2) {
            bestDist2 = d2;
            ref = ni;
          }
        }
      }
      if (ref === -1) continue;
    }

    const p = idx * 4;
    // For deeper band pixels (>=2px inside), only soften if color is close to backdrop
    if (bandDist[idx] >= 2) {
      const dist = backdropDistance(data[p], data[p + 1], data[p + 2], bgR, bgG, bgB);
      if (dist > outerThreshold) continue;
    }

    const rp = ref * 4;
    const vx = data[rp] - bgR;
    const vy = data[rp + 1] - bgG;
    const vz = data[rp + 2] - bgB;
    const v2 = vx * vx + vy * vy + vz * vz;
    if (v2 < 400) continue;

    const ux = data[p] - bgR;
    const uy = data[p + 1] - bgG;
    const uz = data[p + 2] - bgB;

    let t = (ux * vx + uy * vy + uz * vz) / v2;
    if (t <= 0.08) {
      mask[idx] = 0;
    } else if (t < 0.94) {
      t = Math.max(0, Math.min(1, t));
      mask[idx] = Math.round(t * 255);
    }
  }
}

/**
 * Compute an alpha mask (0 = background, 255 = foreground) for the image.
 *
 * @param {Uint8ClampedArray} data - RGBA pixel data
 * @param {number} width
 * @param {number} height
 * @param {object} options
 * @param {'flood'|'global'} [options.mode='flood'] - Edge-connected flood fill or global color key
 * @param {number[]} [options.targetColor] - [r, g, b] background color; auto-detected if omitted
 * @param {number} [options.tolerance=10] - Color distance threshold (0-100)
 * @param {number} [options.softness=14] - Boundary matting width & transition (0-45)
 * @param {Array<{x:number,y:number}>} [options.seeds] - Optional seed points for flood mode
 * @returns {Uint8Array} Alpha mask of length width * height
 */
export function computeBackgroundMask(data, width, height, options = {}) {
  const {
    mode = 'flood',
    targetColor = detectBorderColor(data, width, height),
    tolerance = 10,
    softness = 14,
    seeds = null,
  } = options;

  const total = width * height;
  const mask = new Uint8Array(total);
  mask.fill(255);

  const [tr, tg, tb] = targetColor;

  if (mode === 'global') {
    const maxDist = tolerance + softness;
    for (let i = 0; i < total; i++) {
      const p = i * 4;
      if (data[p + 3] === 0) {
        mask[i] = 0;
        continue;
      }
      const dist = backdropDistance(data[p], data[p + 1], data[p + 2], tr, tg, tb);
      if (dist <= maxDist) {
        mask[i] = smoothstepAlpha(dist, tolerance, softness);
      }
    }
    return mask;
  }

  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  let stackPtr = 0;

  const tryPush = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    const p = idx * 4;
    if (data[p + 3] === 0) {
      visited[idx] = 1;
      mask[idx] = 0;
      stack[stackPtr++] = idx;
      return;
    }
    const dist = backdropDistance(data[p], data[p + 1], data[p + 2], tr, tg, tb);
    if (dist <= tolerance) {
      visited[idx] = 1;
      mask[idx] = 0;
      stack[stackPtr++] = idx;
    }
  };

  if (seeds && seeds.length > 0) {
    for (const seed of seeds) {
      tryPush(seed.x, seed.y);
    }
  } else {
    for (let x = 0; x < width; x++) {
      tryPush(x, 0);
      if (height > 1) tryPush(x, height - 1);
    }
    for (let y = 1; y < height - 1; y++) {
      tryPush(0, y);
      if (width > 1) tryPush(width - 1, y);
    }
  }

  while (stackPtr > 0) {
    const idx = stack[--stackPtr];
    const x = idx % width;
    const y = (idx - x) / width;

    if (x > 0) tryPush(x - 1, y);
    if (x < width - 1) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y < height - 1) tryPush(x, y + 1);
  }

  if (softness > 0) {
    applyBoundaryMatting(data, mask, width, height, targetColor, tolerance, softness);
  }

  return mask;
}

/**
 * Magic-wand flood fill from a specific pixel, modifying an existing mask in place.
 * @param {'remove'|'restore'} action
 */
export function floodFillAtPoint(data, mask, width, height, startX, startY, tolerance, softness, action = 'remove') {
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;
  const startIdx = startY * width + startX;
  const sp = startIdx * 4;
  const tr = data[sp];
  const tg = data[sp + 1];
  const tb = data[sp + 2];
  const maxDist = tolerance + softness * 0.5;

  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  let stackPtr = 0;

  visited[startIdx] = 1;
  stack[stackPtr++] = startIdx;

  while (stackPtr > 0) {
    const idx = stack[--stackPtr];
    const p = idx * 4;
    const dist = backdropDistance(data[p], data[p + 1], data[p + 2], tr, tg, tb);
    const alpha = smoothstepAlpha(dist, tolerance, softness * 0.5);

    if (action === 'remove') {
      mask[idx] = Math.min(mask[idx], alpha);
    } else {
      mask[idx] = Math.max(mask[idx], 255 - alpha);
    }

    const x = idx % width;
    const y = (idx - x) / width;

    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < width - 1 ? idx + 1 : -1,
      y > 0 ? idx - width : -1,
      y < height - 1 ? idx + width : -1,
    ];

    for (let k = 0; k < 4; k++) {
      const nIdx = neighbors[k];
      if (nIdx >= 0 && !visited[nIdx]) {
        const np = nIdx * 4;
        const nDist = backdropDistance(data[np], data[np + 1], data[np + 2], tr, tg, tb);
        if (nDist <= maxDist) {
          visited[nIdx] = 1;
          stack[stackPtr++] = nIdx;
        }
      }
    }
  }
}

/**
 * Paint a circular brush stroke onto the mask in place.
 * @param {'erase'|'restore'} mode
 */
export function applyManualBrush(mask, width, height, cx, cy, radius, hardness = 0.8, mode = 'erase') {
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));
  const innerR = radius * hardness;

  for (let y = minY; y <= maxY; y++) {
    const dy = y - cy;
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;

      const d = Math.sqrt(d2);
      let strength = 1;
      if (d > innerR && radius > innerR) {
        const t = (d - innerR) / (radius - innerR);
        strength = 1 - t * t * (3 - 2 * t);
      }

      const idx = y * width + x;
      if (mode === 'erase') {
        mask[idx] = Math.round(mask[idx] * (1 - strength));
      } else {
        mask[idx] = Math.round(mask[idx] + (255 - mask[idx]) * strength);
      }
    }
  }
}

function buildLocalForegroundMap(mask, width, height) {
  const total = width * height;
  const ref = new Int32Array(total);
  ref.fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < total; i++) {
    if (mask[i] === 0 || mask[i] === 255) continue;
    const x = i % width;
    const y = (i - x) / width;

    const check = (ni) => {
      if (mask[ni] === 255 && ref[i] === -1) {
        ref[i] = ni;
        queue[tail++] = i;
      }
    };
    if (x > 0) check(i - 1);
    if (x < width - 1) check(i + 1);
    if (y > 0) check(i - width);
    if (y < height - 1) check(i + width);
  }

  while (head < tail) {
    const idx = queue[head++];
    const r = ref[idx];
    const x = idx % width;
    const y = (idx - x) / width;
    const spread = (ni) => {
      if (mask[ni] > 0 && mask[ni] < 255 && ref[ni] === -1) {
        ref[ni] = r;
        queue[tail++] = ni;
      }
    };
    if (x > 0) spread(idx - 1);
    if (x < width - 1) spread(idx + 1);
    if (y > 0) spread(idx - width);
    if (y < height - 1) spread(idx + width);
  }

  return ref;
}

/**
 * Apply mask to source image with edge color decontamination (defringing)
 * and foreground color adjustments (brightness, contrast, saturation, hue).
 */
export function applyMaskAndDecontaminate(srcData, mask, width, height, options = {}) {
  const {
    targetColor = [255, 255, 255],
    defringe = 85,
    fgAdjust = null,
  } = options;

  const total = width * height;
  const out = new Uint8ClampedArray(total * 4);
  const [bgR, bgG, bgB] = targetColor;
  const defringeFactor = Math.max(0, Math.min(1, defringe / 100));
  const localFgRef = defringeFactor > 0 ? buildLocalForegroundMap(mask, width, height) : null;

  const hasAdjust = fgAdjust && (
    fgAdjust.brightness !== 0 ||
    fgAdjust.contrast !== 0 ||
    fgAdjust.saturation !== 0 ||
    fgAdjust.hue !== 0
  );

  const brightOffset = hasAdjust ? (fgAdjust.brightness || 0) * 2.55 : 0;
  const contrastFactor = hasAdjust
    ? (259 * ((fgAdjust.contrast || 0) * 2.55 + 255)) / (255 * (259 - (fgAdjust.contrast || 0) * 2.55))
    : 1;
  const satFactor = hasAdjust ? 1 + (fgAdjust.saturation || 0) / 100 : 1;
  const hueRad = hasAdjust ? ((fgAdjust.hue || 0) * Math.PI) / 180 : 0;
  const cosH = Math.cos(hueRad);
  const sinH = Math.sin(hueRad);

  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const origA = srcData[p + 3];
    const maskA = mask[i];
    const finalA = origA === 255 ? maskA : Math.round((origA * maskA) / 255);

    if (finalA === 0) {
      out[p] = 0;
      out[p + 1] = 0;
      out[p + 2] = 0;
      out[p + 3] = 0;
      continue;
    }

    let r = srcData[p];
    let g = srcData[p + 1];
    let b = srcData[p + 2];

    if (defringeFactor > 0 && maskA > 0 && maskA < 255) {
      const a = Math.max(0.15, maskA / 255);
      const invA = 1 - a;
      let fgR = Math.max(0, Math.min(255, (r - invA * bgR) / a));
      let fgG = Math.max(0, Math.min(255, (g - invA * bgG) / a));
      let fgB = Math.max(0, Math.min(255, (b - invA * bgB) / a));

      const refIdx = localFgRef[i];
      if (refIdx !== -1) {
        const rp = refIdx * 4;
        const refWeight = 1 - a * a;
        fgR = fgR * (1 - refWeight) + srcData[rp] * refWeight;
        fgG = fgG * (1 - refWeight) + srcData[rp + 1] * refWeight;
        fgB = fgB * (1 - refWeight) + srcData[rp + 2] * refWeight;
      }

      r = r + (fgR - r) * defringeFactor;
      g = g + (fgG - g) * defringeFactor;
      b = b + (fgB - b) * defringeFactor;
    }

    if (hasAdjust) {
      if (brightOffset !== 0 || contrastFactor !== 1) {
        r = contrastFactor * (r + brightOffset - 128) + 128;
        g = contrastFactor * (g + brightOffset - 128) + 128;
        b = contrastFactor * (b + brightOffset - 128) + 128;
      }

      if (satFactor !== 1) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = lum + (r - lum) * satFactor;
        g = lum + (g - lum) * satFactor;
        b = lum + (b - lum) * satFactor;
      }

      if (hueRad !== 0) {
        const k = 1 / 3;
        const sq = Math.sqrt(k);
        const m00 = cosH + k * (1 - cosH);
        const m01 = k * (1 - cosH) - sq * sinH;
        const m02 = k * (1 - cosH) + sq * sinH;
        const m10 = k * (1 - cosH) + sq * sinH;
        const m11 = cosH + k * (1 - cosH);
        const m12 = k * (1 - cosH) - sq * sinH;
        const m20 = k * (1 - cosH) - sq * sinH;
        const m21 = k * (1 - cosH) + sq * sinH;
        const m22 = cosH + k * (1 - cosH);

        const nr = m00 * r + m01 * g + m02 * b;
        const ng = m10 * r + m11 * g + m12 * b;
        const nb = m20 * r + m21 * g + m22 * b;
        r = nr;
        g = ng;
        b = nb;
      }
    }

    out[p] = r;
    out[p + 1] = g;
    out[p + 2] = b;
    out[p + 3] = finalA;
  }

  return out;
}

/**
 * Composite foreground RGBA data over a transparent, solid, or gradient background.
 */
export function compositeBackground(fgData, width, height, bgOptions = {}) {
  const {
    type = 'transparent',
    color = [219, 21, 20],
    color2 = [153, 27, 27],
    angle = 135,
  } = bgOptions;

  if (type === 'transparent') {
    return new Uint8ClampedArray(fgData);
  }

  const total = width * height;
  const out = new Uint8ClampedArray(total * 4);

  if (type === 'solid') {
    const [br, bg, bb] = color;
    for (let i = 0; i < total; i++) {
      const p = i * 4;
      const a = fgData[p + 3] / 255;
      const invA = 1 - a;
      out[p] = fgData[p] * a + br * invA;
      out[p + 1] = fgData[p + 1] * a + bg * invA;
      out[p + 2] = fgData[p + 2] * a + bb * invA;
      out[p + 3] = 255;
    }
    return out;
  }

  const [r1, g1, b1] = color;
  const [r2, g2, b2] = color2;
  const rad = ((angle - 90) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const maxProj = Math.abs(halfW * dx) + Math.abs(halfH * dy) || 1;

  for (let y = 0; y < height; y++) {
    const ny = y - halfH;
    for (let x = 0; x < width; x++) {
      const nx = x - halfW;
      const proj = (nx * dx + ny * dy) / maxProj;
      const t = Math.max(0, Math.min(1, (proj + 1) * 0.5));
      const br = r1 + (r2 - r1) * t;
      const bg = g1 + (g2 - g1) * t;
      const bb = b1 + (b2 - b1) * t;

      const p = (y * width + x) * 4;
      const a = fgData[p + 3] / 255;
      const invA = 1 - a;
      out[p] = fgData[p] * a + br * invA;
      out[p + 1] = fgData[p + 1] * a + bg * invA;
      out[p + 2] = fgData[p + 2] * a + bb * invA;
      out[p + 3] = 255;
    }
  }

  return out;
}
