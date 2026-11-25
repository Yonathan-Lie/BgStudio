import {
  applyManualBrush,
  applyMaskAndDecontaminate,
  compositeBackground,
  computeBackgroundMask,
  detectBorderColor,
  floodFillAtPoint,
  hexToRgb,
  rgbToHex,
} from './processor.js';

const MAX_HISTORY = 20;

const state = {
  width: 0,
  height: 0,
  srcData: null,
  mask: null,
  history: [],
  historyIndex: -1,
  cutMode: 'flood',
  targetColor: [255, 255, 255],
  tolerance: 10,
  softness: 14,
  defringe: 85,
  bgType: 'solid',
  bgColor: '#DB1514',
  bgColor2: '#7F1D1D',
  bgAngle: 135,
  fgAdjust: { brightness: 0, contrast: 0, saturation: 0, hue: 0 },
  tool: 'view',
  brushSize: 28,
  zoomMode: 'fit',
  peekOriginal: false,
  isPainting: false,
  fileName: 'image',
};

const el = {
  fileInput: document.getElementById('fileInput'),
  dropzone: document.getElementById('dropzone'),
  editor: document.getElementById('editor'),
  canvasViewport: document.getElementById('canvasViewport'),
  canvasStage: document.getElementById('canvasStage'),
  previewCanvas: document.getElementById('previewCanvas'),
  brushCursor: document.getElementById('brushCursor'),
  statusPill: document.getElementById('statusPill'),
  copyBtn: document.getElementById('copyBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),
  resetMaskBtn: document.getElementById('resetMaskBtn'),
  peekOriginalBtn: document.getElementById('peekOriginalBtn'),
  zoomFitBtn: document.getElementById('zoomFitBtn'),
  zoom100Btn: document.getElementById('zoom100Btn'),
  brushSizeWrap: document.getElementById('brushSizeWrap'),
  brushSize: document.getElementById('brushSize'),
  brushSizeVal: document.getElementById('brushSizeVal'),
  solidColorControls: document.getElementById('solidColorControls'),
  gradientControls: document.getElementById('gradientControls'),
  bgColorPicker: document.getElementById('bgColorPicker'),
  bgColorHex: document.getElementById('bgColorHex'),
  bgColor2Picker: document.getElementById('bgColor2Picker'),
  bgColor2Hex: document.getElementById('bgColor2Hex'),
  bgAngle: document.getElementById('bgAngle'),
  bgAngleVal: document.getElementById('bgAngleVal'),
  targetColorPicker: document.getElementById('targetColorPicker'),
  autoDetectBtn: document.getElementById('autoDetectBtn'),
  tolerance: document.getElementById('tolerance'),
  toleranceVal: document.getElementById('toleranceVal'),
  softness: document.getElementById('softness'),
  softnessVal: document.getElementById('softnessVal'),
  defringe: document.getElementById('defringe'),
  defringeVal: document.getElementById('defringeVal'),
  fgBrightness: document.getElementById('fgBrightness'),
  fgBrightnessVal: document.getElementById('fgBrightnessVal'),
  fgContrast: document.getElementById('fgContrast'),
  fgContrastVal: document.getElementById('fgContrastVal'),
  fgSaturation: document.getElementById('fgSaturation'),
  fgSaturationVal: document.getElementById('fgSaturationVal'),
  fgHue: document.getElementById('fgHue'),
  fgHueVal: document.getElementById('fgHueVal'),
  resetAdjustBtn: document.getElementById('resetAdjustBtn'),
  dimLabel: document.getElementById('dimLabel'),
  exportFormat: document.getElementById('exportFormat'),
  qualityRow: document.getElementById('qualityRow'),
  exportQuality: document.getElementById('exportQuality'),
  exportQualityVal: document.getElementById('exportQualityVal'),
};

const ctx = el.previewCanvas.getContext('2d');
let statusTimer = null;

function showStatus(msg) {
  el.statusPill.textContent = msg;
  el.statusPill.classList.remove('hidden');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => el.statusPill.classList.add('hidden'), 2200);
}

function pushHistory(maskCopy) {
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(new Uint8Array(maskCopy));
  if (state.history.length > MAX_HISTORY) {
    state.history.shift();
  }
  state.historyIndex = state.history.length - 1;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  el.undoBtn.disabled = state.historyIndex <= 0;
  el.redoBtn.disabled = state.historyIndex >= state.history.length - 1;
}

function recomputeMask(push = true) {
  if (!state.srcData) return;
  state.mask = computeBackgroundMask(state.srcData, state.width, state.height, {
    mode: state.cutMode,
    targetColor: state.targetColor,
    tolerance: state.tolerance,
    softness: state.softness,
  });
  if (push) pushHistory(state.mask);
  render();
}

function render() {
  if (!state.srcData || !state.mask) return;

  let output;
  if (state.peekOriginal) {
    output = state.srcData;
  } else {
    const fg = applyMaskAndDecontaminate(state.srcData, state.mask, state.width, state.height, {
      targetColor: state.targetColor,
      defringe: state.defringe,
      fgAdjust: state.fgAdjust,
    });
    output = compositeBackground(fg, state.width, state.height, {
      type: state.bgType,
      color: hexToRgb(state.bgColor),
      color2: hexToRgb(state.bgColor2),
      angle: state.bgAngle,
    });
  }

  const imageData = new ImageData(output, state.width, state.height);
  ctx.putImageData(imageData, 0, 0);
}

function applyZoom() {
  if (!state.width || !state.height) return;
  if (state.zoomMode === '100') {
    el.previewCanvas.style.width = `${state.width}px`;
    el.previewCanvas.style.height = `${state.height}px`;
  } else {
    const pad = 48;
    const vw = Math.max(200, el.canvasViewport.clientWidth - pad);
    const vh = Math.max(200, el.canvasViewport.clientHeight - pad);
    const scale = Math.min(1, vw / state.width, vh / state.height);
    el.previewCanvas.style.width = `${Math.round(state.width * scale)}px`;
    el.previewCanvas.style.height = `${Math.round(state.height * scale)}px`;
  }
}

function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  state.fileName = file.name.replace(/\.[^.]+$/, '') || 'image';

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      state.width = img.naturalWidth;
      state.height = img.naturalHeight;
      el.previewCanvas.width = state.width;
      el.previewCanvas.height = state.height;
      ctx.drawImage(img, 0, 0);
      state.srcData = ctx.getImageData(0, 0, state.width, state.height).data;

      state.targetColor = detectBorderColor(state.srcData, state.width, state.height);
      el.targetColorPicker.value = rgbToHex(...state.targetColor);

      state.history = [];
      state.historyIndex = -1;

      el.dropzone.classList.add('hidden');
      el.editor.classList.remove('hidden');
      el.copyBtn.disabled = false;
      el.downloadBtn.disabled = false;
      el.dimLabel.textContent = `${state.width} × ${state.height}`;

      applyZoom();
      recomputeMask(true);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function getCanvasCoords(clientX, clientY) {
  const rect = el.previewCanvas.getBoundingClientRect();
  const x = Math.floor(((clientX - rect.left) / rect.width) * state.width);
  const y = Math.floor(((clientY - rect.top) / rect.height) * state.height);
  return {
    x: Math.max(0, Math.min(state.width - 1, x)),
    y: Math.max(0, Math.min(state.height - 1, y)),
    rect,
  };
}

function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  const isBrush = tool === 'brush-erase' || tool === 'brush-restore';
  el.brushSizeWrap.classList.toggle('hidden', !isBrush);
  el.brushCursor.classList.toggle('hidden', !isBrush);
  el.previewCanvas.style.cursor = tool === 'view' ? 'default' : isBrush ? 'none' : 'crosshair';
}

function setBgType(type) {
  state.bgType = type;
  document.querySelectorAll('[data-bg-type]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.bgType === type);
  });
  el.solidColorControls.classList.toggle('hidden', type === 'transparent');
  el.gradientControls.classList.toggle('hidden', type !== 'gradient');
  render();
}

function setBgColor(hex, isSecondary = false) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  if (isSecondary) {
    state.bgColor2 = hex.toUpperCase();
    el.bgColor2Picker.value = state.bgColor2;
    el.bgColor2Hex.value = state.bgColor2;
  } else {
    state.bgColor = hex.toUpperCase();
    el.bgColorPicker.value = state.bgColor;
    el.bgColorHex.value = state.bgColor;
    document.querySelectorAll('.swatch').forEach((s) => {
      s.classList.toggle('active', s.dataset.preset?.toUpperCase() === state.bgColor && state.bgType === 'solid');
    });
  }
  render();
}

// File input, drag & drop, paste
el.fileInput.addEventListener('change', (e) => {
  if (e.target.files?.[0]) loadImageFile(e.target.files[0]);
  e.target.value = '';
});

['dragenter', 'dragover'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    el.dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((evt) => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    el.dropzone.classList.remove('dragover');
  });
});

window.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) loadImageFile(file);
});

window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      loadImageFile(item.getAsFile());
      break;
    }
  }
});

window.addEventListener('resize', applyZoom);

// Tool buttons
document.querySelectorAll('[data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

el.brushSize.addEventListener('input', () => {
  state.brushSize = Number(el.brushSize.value);
  el.brushSizeVal.textContent = `${state.brushSize}px`;
});

// Canvas pointer interactions
el.previewCanvas.addEventListener('pointerdown', (e) => {
  if (!state.srcData) return;
  const { x, y } = getCanvasCoords(e.clientX, e.clientY);

  if (state.tool === 'eyedropper') {
    const p = (y * state.width + x) * 4;
    state.targetColor = [state.srcData[p], state.srcData[p + 1], state.srcData[p + 2]];
    el.targetColorPicker.value = rgbToHex(...state.targetColor);
    recomputeMask(true);
    showStatus(`Picked background ${rgbToHex(...state.targetColor)}`);
    return;
  }

  if (state.tool === 'wand-remove' || state.tool === 'wand-restore') {
    const action = state.tool === 'wand-remove' ? 'remove' : 'restore';
    floodFillAtPoint(state.srcData, state.mask, state.width, state.height, x, y, state.tolerance, state.softness, action);
    pushHistory(state.mask);
    render();
    return;
  }

  if (state.tool === 'brush-erase' || state.tool === 'brush-restore') {
    state.isPainting = true;
    el.previewCanvas.setPointerCapture(e.pointerId);
    const mode = state.tool === 'brush-erase' ? 'erase' : 'restore';
    applyManualBrush(state.mask, state.width, state.height, x, y, state.brushSize, 0.75, mode);
    render();
  }
});

el.previewCanvas.addEventListener('pointermove', (e) => {
  const isBrush = state.tool === 'brush-erase' || state.tool === 'brush-restore';
  if (isBrush && state.srcData) {
    const rect = el.previewCanvas.getBoundingClientRect();
    const scale = rect.width / state.width;
    const diameter = Math.max(4, state.brushSize * 2 * scale);
    el.brushCursor.style.width = `${diameter}px`;
    el.brushCursor.style.height = `${diameter}px`;
    el.brushCursor.style.left = `${e.clientX - rect.left}px`;
    el.brushCursor.style.top = `${e.clientY - rect.top}px`;
  }

  if (!state.isPainting) return;
  const { x, y } = getCanvasCoords(e.clientX, e.clientY);
  const mode = state.tool === 'brush-erase' ? 'erase' : 'restore';
  applyManualBrush(state.mask, state.width, state.height, x, y, state.brushSize, 0.75, mode);
  render();
});

const finishStroke = () => {
  if (!state.isPainting) return;
  state.isPainting = false;
  pushHistory(state.mask);
};

el.previewCanvas.addEventListener('pointerup', finishStroke);
el.previewCanvas.addEventListener('pointercancel', finishStroke);

// Undo / Redo / Reset / Peek / Zoom
el.undoBtn.addEventListener('click', () => {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  state.mask = new Uint8Array(state.history[state.historyIndex]);
  updateHistoryButtons();
  render();
});

el.redoBtn.addEventListener('click', () => {
  if (state.historyIndex >= state.history.length - 1) return;
  state.historyIndex++;
  state.mask = new Uint8Array(state.history[state.historyIndex]);
  updateHistoryButtons();
  render();
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) el.redoBtn.click();
    else el.undoBtn.click();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    el.redoBtn.click();
  }
});

el.resetMaskBtn.addEventListener('click', () => {
  recomputeMask(true);
  showStatus('Mask reset to automatic');
});

const startPeek = () => {
  state.peekOriginal = true;
  el.peekOriginalBtn.classList.add('active');
  render();
};
const endPeek = () => {
  if (!state.peekOriginal) return;
  state.peekOriginal = false;
  el.peekOriginalBtn.classList.remove('active');
  render();
};
el.peekOriginalBtn.addEventListener('pointerdown', startPeek);
el.peekOriginalBtn.addEventListener('pointerup', endPeek);
el.peekOriginalBtn.addEventListener('pointerleave', endPeek);

el.zoomFitBtn.addEventListener('click', () => {
  state.zoomMode = 'fit';
  applyZoom();
});
el.zoom100Btn.addEventListener('click', () => {
  state.zoomMode = '100';
  applyZoom();
});

// Background Controls
document.querySelectorAll('[data-bg-type]').forEach((btn) => {
  btn.addEventListener('click', () => setBgType(btn.dataset.bgType));
});

document.querySelectorAll('.swatch').forEach((swatch) => {
  swatch.addEventListener('click', () => {
    const preset = swatch.dataset.preset;
    if (preset === 'transparent') {
      setBgType('transparent');
      document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === swatch));
    } else {
      if (state.bgType === 'transparent') setBgType('solid');
      setBgColor(preset, false);
    }
  });
});

el.bgColorPicker.addEventListener('input', (e) => setBgColor(e.target.value, false));
el.bgColorHex.addEventListener('change', (e) => setBgColor(e.target.value, false));
el.bgColor2Picker.addEventListener('input', (e) => setBgColor(e.target.value, true));
el.bgColor2Hex.addEventListener('change', (e) => setBgColor(e.target.value, true));
el.bgAngle.addEventListener('input', () => {
  state.bgAngle = Number(el.bgAngle.value);
  el.bgAngleVal.textContent = `${state.bgAngle}°`;
  render();
});

// Cutout Controls
document.querySelectorAll('[data-cut-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.cutMode = btn.dataset.cutMode;
    document.querySelectorAll('[data-cut-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.cutMode === state.cutMode);
    });
    recomputeMask(true);
  });
});

el.targetColorPicker.addEventListener('input', (e) => {
  state.targetColor = hexToRgb(e.target.value);
  recomputeMask(false);
});
el.targetColorPicker.addEventListener('change', () => pushHistory(state.mask));

el.autoDetectBtn.addEventListener('click', () => {
  if (!state.srcData) return;
  state.targetColor = detectBorderColor(state.srcData, state.width, state.height);
  el.targetColorPicker.value = rgbToHex(...state.targetColor);
  recomputeMask(true);
  showStatus(`Auto-detected ${rgbToHex(...state.targetColor)}`);
});

const bindMaskSlider = (input, label, key, suffix = '') => {
  input.addEventListener('input', () => {
    state[key] = Number(input.value);
    label.textContent = `${state[key]}${suffix}`;
    recomputeMask(false);
  });
  input.addEventListener('change', () => pushHistory(state.mask));
};

bindMaskSlider(el.tolerance, el.toleranceVal, 'tolerance');
bindMaskSlider(el.softness, el.softnessVal, 'softness');

el.defringe.addEventListener('input', () => {
  state.defringe = Number(el.defringe.value);
  el.defringeVal.textContent = `${state.defringe}%`;
  render();
});

// Foreground Color Adjustments
const bindFgSlider = (input, label, key, suffix = '') => {
  input.addEventListener('input', () => {
    state.fgAdjust[key] = Number(input.value);
    label.textContent = `${state.fgAdjust[key]}${suffix}`;
    render();
  });
};

bindFgSlider(el.fgBrightness, el.fgBrightnessVal, 'brightness');
bindFgSlider(el.fgContrast, el.fgContrastVal, 'contrast');
bindFgSlider(el.fgSaturation, el.fgSaturationVal, 'saturation');
bindFgSlider(el.fgHue, el.fgHueVal, 'hue', '°');

el.resetAdjustBtn.addEventListener('click', (e) => {
  e.preventDefault();
  state.fgAdjust = { brightness: 0, contrast: 0, saturation: 0, hue: 0 };
  el.fgBrightness.value = 0; el.fgBrightnessVal.textContent = '0';
  el.fgContrast.value = 0; el.fgContrastVal.textContent = '0';
  el.fgSaturation.value = 0; el.fgSaturationVal.textContent = '0';
  el.fgHue.value = 0; el.fgHueVal.textContent = '0°';
  render();
});

// Export
el.exportFormat.addEventListener('change', () => {
  const isPng = el.exportFormat.value === 'image/png';
  el.qualityRow.classList.toggle('hidden', isPng);
});

el.exportQuality.addEventListener('input', () => {
  el.exportQualityVal.textContent = `${el.exportQuality.value}%`;
});

function getExportCanvas() {
  if (el.exportFormat.value === 'image/jpeg' && state.bgType === 'transparent') {
    // JPG has no alpha channel; composite onto white
    const fg = applyMaskAndDecontaminate(state.srcData, state.mask, state.width, state.height, {
      targetColor: state.targetColor,
      defringe: state.defringe,
      fgAdjust: state.fgAdjust,
    });
    const opaque = compositeBackground(fg, state.width, state.height, {
      type: 'solid',
      color: [255, 255, 255],
    });
    const tmp = document.createElement('canvas');
    tmp.width = state.width;
    tmp.height = state.height;
    tmp.getContext('2d').putImageData(new ImageData(opaque, state.width, state.height), 0, 0);
    return tmp;
  }
  return el.previewCanvas;
}

el.downloadBtn.addEventListener('click', () => {
  if (!state.srcData) return;
  const mime = el.exportFormat.value;
  const ext = mime.split('/')[1] === 'jpeg' ? 'jpg' : mime.split('/')[1];
  const quality = Number(el.exportQuality.value) / 100;
  const canvas = getExportCanvas();

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.fileName}-bg.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, mime, quality);
});

el.copyBtn.addEventListener('click', () => {
  if (!state.srcData || !navigator.clipboard?.write) return;
  el.previewCanvas.toBlob(async (blob) => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showStatus('Copied PNG to clipboard');
    } catch {
      showStatus('Clipboard copy blocked by browser');
    }
  }, 'image/png');
});
