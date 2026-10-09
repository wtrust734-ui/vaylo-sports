// ============================================================================
// TINY PNG TOOL — for auditing emulator screenshots
// ----------------------------------------------------------------------------
// A throwaway diagnostic, not part of the app or the site. It exists because
// eyeballing a downscaled screenshot produced contradictory measurements of the
// same bar three times in a row, and a pixel is not a matter of opinion.
//
//   node app-audit-shots/png.cjs crop <in> <out> <x> <y> <w> <h>
//   node app-audit-shots/png.cjs rows <in> [fromY] [toY] [threshold]
//   node app-audit-shots/png.cjs cols <in> <fromY> <toY> [tol] [merge] [minRun]
//   node app-audit-shots/png.cjs info <in>
//
// Decoding is IHDR/IDAT/IEND plus the five PNG scanline filters, which is all a
// screencap needs (8-bit RGBA, no interlacing, no palette).
// ============================================================================

const fs = require("fs");
const zlib = require("zlib");

// ------------------------------------------------------------------ CRC32 --
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// ------------------------------------------------------------------ decode --
function decode(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error(`${file}: not a PNG`);
  }
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced PNGs are not supported");
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

// ------------------------------------------------------------------ encode --
function encode(img, file) {
  const { width, height, channels, data } = img;
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ])
  );
}

function crop(img, x, y, w, h) {
  const { width, channels, data } = img;
  const cx = Math.max(0, Math.min(x, width));
  const cy = Math.max(0, Math.min(y, img.height));
  const cw = Math.min(w, width - cx);
  const ch = Math.min(h, img.height - cy);
  const out = Buffer.alloc(cw * ch * channels);
  const srcStride = width * channels;
  for (let r = 0; r < ch; r++) {
    data.copy(out, r * cw * channels, (cy + r) * srcStride + cx * channels,
      (cy + r) * srcStride + (cx + cw) * channels);
  }
  return { width: cw, height: ch, channels, data: out };
}

// ------------------------------------------------------------------- utils --
const lum = (img, x, y) => {
  const i = (y * img.width + x) * img.channels;
  const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Rows containing runs of unusually bright pixels — how a system bar shows up. */
function brightRows(img, fromY, toY, threshold) {
  const rows = [];
  for (let y = fromY; y < Math.min(toY, img.height); y++) {
    let lo = -1, hi = -1, n = 0;
    for (let x = 0; x < img.width; x++) {
      if (lum(img, x, y) >= threshold) {
        if (lo < 0) lo = x;
        hi = x;
        n++;
      }
    }
    if (n > 4) rows.push({ y, lo, hi, n });
  }
  return rows;
}

/**
 * x-intervals of "ink" within a horizontal band, and whether they are centred.
 *
 * This is the measurement the eye kept getting wrong. The bottom bar's five
 * items are content-sized, so their centres are not arithmetically obvious, and
 * a 14px offset in a downscaled screenshot is indistinguishable from an
 * artefact of the scaling. Comparing where the ink actually is against the
 * image's own centre line is not a matter of opinion.
 *
 * Background is estimated per band rather than assumed: the panel behind this
 * ink is translucent, so it is not a constant colour, and a fixed luminance
 * threshold would classify a brighter patch of panel as ink.
 */
function cols(img, fromY, toY, tol, merge, minRun) {
  const y1 = Math.min(toY, img.height);
  const maxLum = new Float64Array(img.width);
  for (let x = 0; x < img.width; x++) {
    let m = 0;
    for (let y = fromY; y < y1; y++) {
      const l = lum(img, x, y);
      if (l > m) m = l;
    }
    maxLum[x] = m;
  }
  // The panel is the low plateau; its top is a better baseline than a mean that
  // ink would drag upward.
  const sorted = Array.from(maxLum).sort((a, b) => a - b);
  const bg = sorted[Math.floor(sorted.length * 0.25)];
  const runs = [];
  let cur = null;
  for (let x = 0; x < img.width; x++) {
    if (maxLum[x] > bg + tol) {
      if (!cur) cur = { lo: x, hi: x, sum: 0, n: 0 };
      cur.hi = x;
      cur.sum += maxLum[x];
      cur.n++;
    } else if (cur) {
      runs.push(cur);
      cur = null;
    }
  }
  if (cur) runs.push(cur);
  // Merge runs separated by a hairline gap: a letter's own counters and the
  // gap between two glyphs of one word are not separate elements.
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r.lo - last.hi <= merge) {
      last.hi = r.hi;
      last.sum += r.sum;
      last.n += r.n;
    } else {
      merged.push({ ...r });
    }
  }
  const kept = merged.filter((r) => r.hi - r.lo + 1 >= minRun);
  const centre = img.width / 2;
  console.log(
    `band y=${fromY}..${y1}  bg=${bg.toFixed(1)}  centre=${centre} (${(centre / 2.625).toFixed(1)} css)`
  );
  for (const r of kept) {
    const mid = (r.lo + r.hi) / 2;
    console.log(
      `  x=${String(r.lo).padStart(4)}..${String(r.hi).padStart(4)}` +
        `  w=${String(r.hi - r.lo + 1).padStart(4)}` +
        `  mid=${mid.toFixed(0).padStart(4)}  offset=${(mid - centre >= 0 ? "+" : "") + (mid - centre).toFixed(0)}px` +
        `  css=${(r.lo / 2.625).toFixed(1)}..${(r.hi / 2.625).toFixed(1)} mid=${(mid / 2.625).toFixed(1)}`
    );
  }
  if (kept.length) {
    const lo = kept[0].lo, hi = kept[kept.length - 1].hi;
    console.log(
      `  span ${lo}..${hi}  ink centre=${((lo + hi) / 2).toFixed(0)}` +
        `  offset=${(((lo + hi) / 2 - centre) >= 0 ? "+" : "") + ((lo + hi) / 2 - centre).toFixed(0)}px` +
        `  css centre=${(((lo + hi) / 2) / 2.625).toFixed(1)}`
    );
  }
  return kept;
}

// When required as a module, hand the primitives back instead of running the CLI —
// the probes in this directory compose them (see topgap.cjs).
if (require.main !== module) {
  module.exports = { decode, encode, crop, lum, brightRows, cols };
  return;
}

const [cmd, file, ...rest] = process.argv.slice(2);

if (cmd === "info") {
  const img = decode(file);
  console.log(JSON.stringify({ width: img.width, height: img.height, channels: img.channels }));
} else if (cmd === "crop") {
  const [out, x, y, w, h] = rest;
  encode(crop(decode(file), +x, +y, +w, +h), out);
  console.log(`wrote ${out} (${w}x${h} from ${x},${y})`);
} else if (cmd === "rows") {
  const img = decode(file);
  const fromY = +(rest[0] ?? img.height - 300);
  const toY = +(rest[1] ?? img.height);
  const threshold = +(rest[2] ?? 200);
  const rows = brightRows(img, fromY, toY, threshold);
  if (!rows.length) console.log(`no bright rows in ${fromY}..${toY} (threshold ${threshold})`);
  for (const r of rows) {
    console.log(
      `y=${r.y}  bright px=${String(r.n).padStart(4)}  x=${r.lo}..${r.hi}` +
        `  cssY=${(r.y / 2.625).toFixed(1)}  cssX=${(r.lo / 2.625).toFixed(1)}..${(r.hi / 2.625).toFixed(1)}`
    );
  }
} else if (cmd === "cols") {
  const img = decode(file);
  cols(img, +(rest[0] ?? 0), +(rest[1] ?? img.height), +(rest[2] ?? 18), +(rest[3] ?? 8), +(rest[4] ?? 3));
} else {
  console.log("usage: crop|rows|cols|info");
  process.exit(1);
}
