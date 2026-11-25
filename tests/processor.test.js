import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyManualBrush,
  applyMaskAndDecontaminate,
  backdropDistance,
  colorDistance,
  compositeBackground,
  computeBackgroundMask,
  detectBorderColor,
  floodFillAtPoint,
  hexToRgb,
  rgbToHex,
} from '../src/processor.js';

function makeImage(width, height, fillRgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    data[p] = fillRgba[0];
    data[p + 1] = fillRgba[1];
    data[p + 2] = fillRgba[2];
    data[p + 3] = fillRgba[3];
  }
  return data;
}

function setPixel(data, width, x, y, rgba) {
  const p = (y * width + x) * 4;
  data[p] = rgba[0];
  data[p + 1] = rgba[1];
  data[p + 2] = rgba[2];
  data[p + 3] = rgba[3];
}

test('hexToRgb and rgbToHex roundtrip', () => {
  assert.deepEqual(hexToRgb('#DB1514'), [219, 21, 20]);
  assert.deepEqual(hexToRgb('#f0a'), [255, 0, 170]);
  assert.equal(rgbToHex(219, 21, 20), '#db1514');
});

test('colorDistance is 0 for identical colors and ~100 for black vs white', () => {
  assert.equal(colorDistance(100, 150, 200, 100, 150, 200), 0);
  const bw = colorDistance(0, 0, 0, 255, 255, 255);
  assert.ok(bw > 99 && bw <= 100.1, `expected ~100, got ${bw}`);
});

test('detectBorderColor ignores dark subject touching bottom edge', () => {
  const w = 10;
  const h = 10;
  const data = makeImage(w, h, [255, 255, 255, 255]);
  // Dark suit covering 60% of bottom row
  for (let x = 2; x <= 7; x++) {
    setPixel(data, w, x, 9, [20, 20, 20, 255]);
  }
  const detected = detectBorderColor(data, w, h);
  assert.deepEqual(detected, [255, 255, 255]);
});

test('flood mode removes outer white backdrop while preserving enclosed white shirt', () => {
  const w = 7;
  const h = 7;
  const data = makeImage(w, h, [255, 255, 255, 255]);
  // Draw a dark 5x5 suit box from (1,1) to (5,5)
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      setPixel(data, w, x, y, [25, 25, 25, 255]);
    }
  }
  // Put an enclosed white shirt pixel at center (3,3)
  setPixel(data, w, 3, 3, [255, 255, 255, 255]);

  const mask = computeBackgroundMask(data, w, h, {
    mode: 'flood',
    targetColor: [255, 255, 255],
    tolerance: 10,
    softness: 0,
  });

  // Outer corner (0,0) is removed
  assert.equal(mask[0], 0);
  // Suit pixel (1,1) is preserved
  assert.equal(mask[1 * w + 1], 255);
  // Enclosed white shirt pixel (3,3) is preserved!
  assert.equal(mask[3 * w + 3], 255);
});

test('global mode removes matching color even when enclosed', () => {
  const w = 7;
  const h = 7;
  const data = makeImage(w, h, [255, 255, 255, 255]);
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      setPixel(data, w, x, y, [25, 25, 25, 255]);
    }
  }
  setPixel(data, w, 3, 3, [255, 255, 255, 255]);

  const mask = computeBackgroundMask(data, w, h, {
    mode: 'global',
    targetColor: [255, 255, 255],
    tolerance: 10,
    softness: 0,
  });

  assert.equal(mask[0], 0);
  assert.equal(mask[3 * w + 3], 0);
});

test('applyMaskAndDecontaminate + compositeBackground turns white backdrop to red', () => {
  const w = 4;
  const h = 4;
  const data = makeImage(w, h, [255, 255, 255, 255]);
  setPixel(data, w, 1, 1, [30, 30, 30, 255]);

  const mask = computeBackgroundMask(data, w, h, {
    mode: 'flood',
    targetColor: [255, 255, 255],
    tolerance: 10,
    softness: 0,
  });

  const fg = applyMaskAndDecontaminate(data, mask, w, h, {
    targetColor: [255, 255, 255],
    defringe: 70,
  });

  const redBg = compositeBackground(fg, w, h, {
    type: 'solid',
    color: [219, 21, 20],
  });

  // Outer pixel (0,0) becomes ID Red
  assert.equal(redBg[0], 219);
  assert.equal(redBg[1], 21);
  assert.equal(redBg[2], 20);
  assert.equal(redBg[3], 255);

  // Foreground pixel (1,1) stays dark
  const p = (1 * w + 1) * 4;
  assert.equal(redBg[p], 30);
  assert.equal(redBg[p + 1], 30);
  assert.equal(redBg[p + 2], 30);
});

test('floodFillAtPoint and applyManualBrush modify mask in place', () => {
  const w = 5;
  const h = 5;
  const data = makeImage(w, h, [200, 200, 200, 255]);
  const mask = new Uint8Array(w * h).fill(255);

  floodFillAtPoint(data, mask, w, h, 2, 2, 10, 0, 'remove');
  assert.equal(mask[2 * w + 2], 0);

  applyManualBrush(mask, w, h, 2, 2, 1, 1, 'restore');
  assert.equal(mask[2 * w + 2], 255);
});

test('backdropDistance protects warm skin highlights while catching neutral fringes', () => {
  const neutralGrayDist = backdropDistance(215, 215, 215, 255, 255, 255);
  const warmSkinDist = backdropDistance(240, 215, 205, 255, 255, 255);
  assert.ok(neutralGrayDist < 12, `expected neutral gray < 12, got ${neutralGrayDist}`);
  assert.ok(warmSkinDist > 15, `expected warm skin > 15, got ${warmSkinDist}`);
});

test('boundary matting decontaminates gray hair fringe without leaking into skin highlight', () => {
  const w = 11;
  const h = 9;
  const data = makeImage(w, h, [255, 255, 255, 255]);
  // Subject block y=1..7, x=2..9; 1px gray hair fringe at x=1
  for (let y = 1; y <= 7; y++) {
    setPixel(data, w, 1, y, [180, 180, 180, 255]); // hair fringe
    for (let x = 2; x <= 4; x++) {
      setPixel(data, w, x, y, [25, 25, 25, 255]); // black hair
    }
    setPixel(data, w, 5, y, [225, 190, 175, 255]); // skin
    setPixel(data, w, 6, y, [245, 222, 212, 255]); // inner ear highlight
    setPixel(data, w, 7, y, [245, 222, 212, 255]); // inner ear highlight
    setPixel(data, w, 8, y, [242, 218, 208, 255]); // bright outer ear rim
    setPixel(data, w, 9, y, [225, 190, 175, 255]); // ear outer edge
  }

  const mask = computeBackgroundMask(data, w, h, {
    mode: 'flood',
    targetColor: [255, 255, 255],
    tolerance: 10,
    softness: 14,
  });

  // Hair fringe pixel (1,4) should have partial alpha
  assert.ok(mask[4 * w + 1] > 40 && mask[4 * w + 1] < 130, `fringe mask=${mask[4 * w + 1]}`);
  // Inner ear highlight (6,4) must stay 100% opaque
  assert.equal(mask[4 * w + 6], 255, `ear highlight mask=${mask[4 * w + 6]}`);

  const fg = applyMaskAndDecontaminate(data, mask, w, h, {
    targetColor: [255, 255, 255],
    defringe: 85,
  });
  const red = compositeBackground(fg, w, h, { type: 'solid', color: [219, 21, 20] });
  const fp = (4 * w + 1) * 4;
  assert.ok(red[fp + 1] < 55 && red[fp + 2] < 55, `expected dark hair over red, got [${red[fp]},${red[fp+1]},${red[fp+2]}]`);
});
