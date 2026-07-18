// DICOM (.dcm) medical image format support
// Parses pixel data and converts to displayable formats via sharp
const fs = require('fs');
const sharp = require('sharp');

let dicomParser;
try {
  dicomParser = require('dicom-parser');
} catch (e) {
  dicomParser = null;
  console.warn('[DICOM] dicom-parser not available, .dcm support disabled');
}

/**
 * Check if a DICOM file can be parsed
 */
function isDicomAvailable() {
  return dicomParser !== null;
}

/**
 * Parse DICOM file and extract pixel data as a raw RGBA buffer
 * @param {string} filePath - Path to .dcm file
 * @returns {{ pixels: Buffer, width: number, height: number, bitsStored: number, photometricInterpretation: string }}
 */
async function parseDicom(filePath) {
  if (!isDicomAvailable()) {
    throw new Error('dicom-parser not installed');
  }

  const buffer = await fs.promises.readFile(filePath);
  const byteArray = new Uint8Array(buffer);

  let dataSet;
  try {
    dataSet = dicomParser.parseDicom(byteArray);
  } catch (e) {
    throw new Error(`DICOM parse error: ${e.message}`);
  }

  const rows = dataSet.uint16('x00280010');
  const columns = dataSet.uint16('x00280011');
  const bitsStored = dataSet.uint16('x00280101') || 8;
  const bitsAllocated = dataSet.uint16('x00280100') || 8;
  const samplesPerPixel = dataSet.uint16('x00280002') || 1;
  const photometricInterpretation = (dataSet.string('x00280004') || 'MONOCHROME2').trim();
  const pixelRepresentation = dataSet.uint16('x00280103') || 0; // 0=unsigned, 1=signed
  const windowCenter = dataSet.floatString('x00281050'); // can be multi-valued
  const windowWidth = dataSet.floatString('x00281051');
  const rescaleSlope = dataSet.floatString('x00281053') || 1;
  const rescaleIntercept = dataSet.floatString('x00281052') || 0;

  if (!rows || !columns) {
    throw new Error('DICOM missing dimensions');
  }

  // Get pixel data
  const pixelData = dataSet.byteArray('x7FE00010');
  if (!pixelData || pixelData.length === 0) {
    throw new Error('DICOM has no pixel data (may be compressed)');
  }

  // Extract and normalize pixel data to 8-bit RGBA
  const pixels = normalizePixels(pixelData, {
    rows, columns,
    bitsStored, bitsAllocated, samplesPerPixel,
    photometricInterpretation, pixelRepresentation,
    windowCenter, windowWidth,
    rescaleSlope, rescaleIntercept
  });

  return { pixels, width: columns, height: rows, bitsStored, photometricInterpretation };
}

/**
 * Convert raw DICOM pixel data to normalized 8-bit RGBA buffer
 */
function normalizePixels(pixelData, opts) {
  const {
    rows, columns, bitsStored, bitsAllocated,
    samplesPerPixel, photometricInterpretation, pixelRepresentation,
    windowCenter, windowWidth, rescaleSlope, rescaleIntercept
  } = opts;

  const width = columns;
  const height = rows;
  const totalPixels = width * height;
  const rgba = Buffer.alloc(totalPixels * 4);

  // Determine effective window for contrast stretching
  let wc = parseFloat(windowCenter) || 128;
  let ww = parseFloat(windowWidth) || 256;

  const isSigned = pixelRepresentation === 1;
  const bytesPerSample = Math.ceil(bitsAllocated / 8);
  const isMono = samplesPerPixel === 1;

  // Read pixel values
  for (let i = 0; i < totalPixels; i++) {
    let value = readPixelValue(pixelData, i, bytesPerSample, bitsStored, isSigned);

    // Apply rescale if needed
    if (rescaleSlope !== 1 || rescaleIntercept !== 0) {
      value = value * rescaleSlope + rescaleIntercept;
    }

    // Apply window/level
    const lower = wc - ww / 2;
    const upper = wc + ww / 2;
    let normalized;
    if (value <= lower) {
      normalized = 0;
    } else if (value >= upper) {
      normalized = 255;
    } else {
      normalized = ((value - lower) / ww) * 255;
    }

    // Clamp
    const gray = Math.max(0, Math.min(255, Math.round(normalized)));

    // Handle photometric interpretation
    let r, g, b, a;
    if (isMono) {
      if (photometricInterpretation === 'MONOCHROME1') {
        // Invert: white = min value
        r = g = b = 255 - gray;
      } else {
        // MONOCHROME2: white = max value
        r = g = b = gray;
      }
      a = 255;
    } else {
      // RGB: read 3 consecutive samples
      const idx3 = i * 3;
      const rVal = readPixelValue(pixelData, idx3, 1, 8, false);
      const gVal = readPixelValue(pixelData, idx3 + 1, 1, 8, false);
      const bVal = readPixelValue(pixelData, idx3 + 2, 1, 8, false);

      if (photometricInterpretation === 'YBR_FULL' || photometricInterpretation === 'YBR_FULL_422') {
        // Convert YCbCr to RGB
        const y = rVal, cb = gVal - 128, cr = bVal - 128;
        r = Math.round(y + 1.402 * cr);
        g = Math.round(y - 0.344136 * cb - 0.714136 * cr);
        b = Math.round(y + 1.772 * cb);
      } else {
        r = rVal; g = gVal; b = bVal;
      }
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      a = 255;
    }

    const offset = i * 4;
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = a;
  }

  return rgba;
}

function readPixelValue(data, index, bytesPerSample, bitsStored, isSigned) {
  let value;
  if (bytesPerSample === 1) {
    value = data[index];
    if (isSigned && value > 127) value = value - 256;
  } else if (bytesPerSample === 2) {
    const lo = data[index * 2];
    const hi = data[index * 2 + 1] || 0;
    value = lo + (hi << 8);
    if (isSigned && bitsStored === 16 && value > 32767) value = value - 65536;
    if (isSigned && bitsStored < 16 && (value & (1 << (bitsStored - 1)))) {
      value = value - (1 << bitsStored);
    }
  } else {
    value = data[index];
  }
  return value;
}

/**
 * Generate a DICOM thumbnail using sharp
 */
async function generateDicomThumbnail(filePath, size, fit) {
  const { pixels, width, height } = await parseDicom(filePath);

  const resizeOpts = fit === 'inside'
    ? { fit: 'inside', withoutEnlargement: true }
    : { fit: 'cover', position: 'centre' };

  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .resize(size, size, resizeOpts)
    .jpeg({ quality: 80 })
    .toBuffer();
}

/**
 * Generate a full-resolution DICOM preview as JPEG
 */
async function generateDicomPreview(filePath) {
  const { pixels, width, height } = await parseDicom(filePath);

  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Get basic DICOM metadata without full pixel extraction
 */
async function getDicomMetadata(filePath) {
  if (!isDicomAvailable()) return null;

  try {
    const buffer = await fs.promises.readFile(filePath);
    const byteArray = new Uint8Array(buffer);
    const dataSet = dicomParser.parseDicom(byteArray);

    return {
      width: dataSet.uint16('x00280010') || 0,
      height: dataSet.uint16('x00280011') || 0,
      bitsStored: dataSet.uint16('x00280101') || 8,
      photometricInterpretation: (dataSet.string('x00280004') || 'MONOCHROME2').trim(),
      modality: (dataSet.string('x00080060') || '').trim(),
      patientName: (dataSet.string('x00100010') || '').trim(),
      studyDate: (dataSet.string('x00080020') || '').trim(),
    };
  } catch (e) {
    return null;
  }
}

module.exports = {
  isDicomAvailable,
  parseDicom,
  generateDicomThumbnail,
  generateDicomPreview,
  getDicomMetadata
};
