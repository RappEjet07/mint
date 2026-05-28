const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const iconsDir = path.join(__dirname, "icons");

// Create a simple PNG using pure Node.js (no dependencies)
// This creates a valid PNG file with a solid purple/blue gradient-ish color

function createPNG(width, height, r, g, b) {
  // PNG file format
  function crc32(buf) {
    let crc = 0xffffffff;
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c;
    }
    for (let i = 0; i < buf.length; i++) {
      crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const typeBytes = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcData = Buffer.concat([typeBytes, data]);
    const crcVal = Buffer.alloc(4);
    crcVal.writeUInt32BE(crc32(crcData));
    return Buffer.concat([len, typeBytes, data, crcVal]);
  }

  // Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT - raw image data with zlib
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter byte: None
    for (let x = 0; x < width; x++) {
      // Create a gradient effect
      const fx = x / width;
      const fy = y / height;
      const t = (fx + fy) / 2;

      // Gradient from purple (#7C3AED) to blue (#2563EB) to cyan (#06B6D4)
      let pr, pg, pb;
      if (t < 0.5) {
        const lt = t * 2;
        pr = Math.round(124 + (37 - 124) * lt);
        pg = Math.round(58 + (99 - 58) * lt);
        pb = Math.round(237 + (235 - 237) * lt);
      } else {
        const lt = (t - 0.5) * 2;
        pr = Math.round(37 + (6 - 37) * lt);
        pg = Math.round(99 + (182 - 99) * lt);
        pb = Math.round(235 + (212 - 235) * lt);
      }

      // Apply rounded rectangle mask (approximate)
      const cx = x / width - 0.5;
      const cy = y / height - 0.5;
      const radius = 0.22; // corner radius
      const dx = Math.max(Math.abs(cx) - (0.5 - radius), 0);
      const dy = Math.max(Math.abs(cy) - (0.5 - radius), 0);
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > radius) {
        // Outside rounded rect - transparent (but we're RGB, so use a dark bg)
        pr = 15;
        pg = 15;
        pb = 26;
      }

      // Draw "S" shape in white (approximate)
      const nx = x / width;
      const ny = y / height;

      // S curve path detection (simplified)
      let isWhite = false;
      const strokeWidth = 0.08;

      // Top horizontal line (y ≈ 0.28, x from 0.36 to 0.64)
      if (ny > 0.24 && ny < 0.32 && nx > 0.36 && nx < 0.68) isWhite = true;
      // Left vertical (x ≈ 0.36, y from 0.28 to 0.5)
      if (nx > 0.28 && nx < 0.36 && ny > 0.28 && ny < 0.53) isWhite = true;
      // Middle horizontal (y ≈ 0.5, x from 0.36 to 0.64)
      if (ny > 0.49 && ny < 0.56 && nx > 0.36 && nx < 0.68) isWhite = true;
      // Right vertical (x ≈ 0.64, y from 0.5 to 0.72)
      if (nx > 0.64 && nx < 0.72 && ny > 0.49 && ny < 0.75) isWhite = true;
      // Bottom horizontal (y ≈ 0.72, x from 0.36 to 0.64)
      if (ny > 0.7 && ny < 0.78 && nx > 0.32 && nx < 0.68) isWhite = true;

      // Top right dot
      const dotR = 0.05;
      const d1 = Math.sqrt((nx - 0.66) ** 2 + (ny - 0.28) ** 2);
      if (d1 < dotR) isWhite = true;
      // Bottom left dot
      const d2 = Math.sqrt((nx - 0.36) ** 2 + (ny - 0.78) ** 2);
      if (d2 < dotR) isWhite = true;

      if (isWhite && dist <= radius) {
        pr = 255;
        pg = 255;
        pb = 255;
      }

      rawData.push(pr, pg, pb);
    }
  }

  // Compress with zlib
  const zlib = require("zlib");
  const rawBuf = Buffer.from(rawData);
  const compressed = zlib.deflateSync(rawBuf);

  const ihdrChunk = chunk("IHDR", ihdr);
  const idatChunk = chunk("IDAT", compressed);
  const iendChunk = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Generate icons
[16, 48, 128].forEach((size) => {
  const png = createPNG(size, size, 124, 58, 237);
  const filePath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Created ${filePath} (${png.length} bytes)`);
});

console.log("Done! Icons created.");
