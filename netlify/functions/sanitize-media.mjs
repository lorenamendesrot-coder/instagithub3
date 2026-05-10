// sanitize-media.mjs — limpeza de metadados + variação de hash por conta
// NÃO faz corte de vídeo, NÃO modifica frames
// MP4: remove metadados, varia timestamps e injeta átomo free com bytes aleatórios
// Imagens: remove EXIF/XMP, injeta comentário aleatório

import crypto from "crypto";

const randBytes = (n) => crypto.randomBytes(n);
const randF     = (min, max) => Math.random() * (max - min) + min;

// ─── JPEG ─────────────────────────────────────────────────────────────────────
function processJpeg(buf) {
  try {
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return buf;
    // Remove segmentos EXIF/XMP/IPTC, mantém tudo mais
    const DROP = new Set([0xE1, 0xE2, 0xED]); // APP1(EXIF/XMP), APP2, APP13(IPTC)
    const out = [Buffer.from([0xFF, 0xD8])];
    let i = 2;
    while (i < buf.length - 1) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xDA) { out.push(buf.slice(i)); break; }   // SOS — resto do arquivo
      if (marker === 0xD9) { out.push(Buffer.from([0xFF, 0xD9])); break; }
      if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0xD8) { out.push(buf.slice(i, i + 2)); i += 2; continue; }
      if (i + 3 >= buf.length) break;
      const segLen = buf.readUInt16BE(i + 2);
      const segEnd = i + 2 + segLen;
      // Descarta APP1 com EXIF ("Exif\0") ou XMP ("http"), APP2, APP13
      const isExif = marker === 0xE1 && buf.slice(i + 4, i + 8).toString() === "Exif";
      const isXmp  = marker === 0xE1 && buf.slice(i + 4, i + 12).toString().startsWith("http");
      if (DROP.has(marker) || isExif || isXmp) { i = segEnd; continue; }
      out.push(buf.slice(i, segEnd));
      i = segEnd;
    }
    // Injeta comentário COM com bytes aleatórios (muda hash, invisível)
    const rnd = randBytes(16);
    const com = Buffer.allocUnsafe(4 + 16);
    com[0] = 0xFF; com[1] = 0xFE;
    com.writeUInt16BE(18, 2);
    rnd.copy(com, 4);
    out.splice(1, 0, com);
    return Buffer.concat(out);
  } catch { return buf; }
}

// ─── PNG ──────────────────────────────────────────────────────────────────────
function processPng(buf) {
  try {
    const PNG_SIG  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!buf.slice(0, 8).equals(PNG_SIG)) return buf;
    const DROP = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "iCCP", "tIME"]);
    const out = [PNG_SIG];
    let i = 8;
    while (i < buf.length) {
      if (i + 8 > buf.length) break;
      const len   = buf.readUInt32BE(i);
      const type  = buf.slice(i + 4, i + 8).toString("ascii");
      const total = 4 + 4 + len + 4;
      if (!DROP.has(type)) out.push(buf.slice(i, i + total));
      i += total;
    }
    // Injeta tEXt com bytes aleatórios antes do IEND
    const rnd   = randBytes(16);
    const key   = Buffer.from("Comment\0");
    const data  = Buffer.concat([key, rnd]);
    const chunk = Buffer.allocUnsafe(4 + 4 + data.length + 4);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write("tEXt", 4, "ascii");
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.slice(4, 8 + data.length)), 8 + data.length);
    out.splice(out.length - 1, 0, chunk); // antes do IEND
    return Buffer.concat(out);
  } catch { return buf; }
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── WebP ─────────────────────────────────────────────────────────────────────
function processWebp(buf) {
  try {
    if (buf.slice(0, 4).toString() !== "RIFF") return buf;
    if (buf.slice(8, 12).toString() !== "WEBP") return buf;
    const DROP = new Set(["EXIF", "XMP "]);
    const out  = [buf.slice(0, 12)];
    let i = 12;
    while (i < buf.length) {
      if (i + 8 > buf.length) break;
      const type  = buf.slice(i, i + 4).toString("ascii");
      const size  = buf.readUInt32LE(i + 4);
      const total = 8 + size + (size % 2);
      if (!DROP.has(type)) out.push(buf.slice(i, i + total));
      i += total;
    }
    // Injeta chunk desconhecido com bytes aleatórios
    const rnd   = randBytes(16);
    const chunk = Buffer.allocUnsafe(8 + 16);
    chunk.write("UNKN", 0, "ascii");
    chunk.writeUInt32LE(16, 4);
    rnd.copy(chunk, 8);
    out.push(chunk);
    const result = Buffer.concat(out);
    result.writeUInt32LE(result.length - 8, 4);
    return result;
  } catch { return buf; }
}

// ─── MP4 ──────────────────────────────────────────────────────────────────────
// Remove átomos de metadados e injeta variação de hash
// NÃO toca em mdat (frames de vídeo), NÃO recorta, NÃO recodifica

const MP4_META_ATOMS = new Set([
  "udta", "meta", "ilst",
  "©nam", "©art", "©day", "©too", "©cmt", "©alb", "©gen",
  "desc", "cprt", "auth", "titl", "gnre", "aART",
]);
const MP4_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

function removeMp4Metadata(buf) {
  try {
    const result = Buffer.from(buf);
    let i = 0;
    while (i < result.length - 8) {
      const size = result.readUInt32BE(i);
      if (size < 8 || i + size > result.length) break;
      const type = result.slice(i + 4, i + 8).toString("latin1");
      // Apaga conteúdo do átomo de metadados (mantém o átomo mas zera conteúdo)
      if (MP4_META_ATOMS.has(type)) {
        result.fill(0, i + 8, i + size);
        result.write("free", i + 4, "latin1"); // renomeia para "free" (ignorado)
      }
      if (MP4_CONTAINERS.has(type) && size > 8) { i += 8; continue; }
      i += size;
    }
    return result;
  } catch { return buf; }
}

function varyMp4Timestamps(buf) {
  try {
    const result = Buffer.from(buf);
    let i = 0;
    while (i < result.length - 8) {
      const size = result.readUInt32BE(i);
      if (size < 8 || i + size > result.length) break;
      const type = result.slice(i + 4, i + 8).toString("ascii");
      if (type === "mvhd" && size >= 28) {
        const base    = i + 8;
        const version = result[base];
        const jitter  = Math.floor(randF(-600, 600)); // ±10 min em segundos
        if (version === 0) {
          // 32-bit timestamps
          const ct = result.readUInt32BE(base + 1);
          const mt = result.readUInt32BE(base + 5);
          result.writeUInt32BE(Math.max(0, ct + jitter), base + 1);
          result.writeUInt32BE(Math.max(0, mt + jitter), base + 5);
        } else if (version === 1) {
          // 64-bit timestamps
          const ctHi = result.readUInt32BE(base + 1);
          const ctLo = result.readUInt32BE(base + 5);
          const mtHi = result.readUInt32BE(base + 9);
          const mtLo = result.readUInt32BE(base + 13);
          result.writeUInt32BE(Math.max(0, ctLo + jitter) >>> 0, base + 5);
          result.writeUInt32BE(Math.max(0, mtLo + jitter) >>> 0, base + 13);
        }
        break;
      }
      const containers = new Set(["moov", "trak", "mdia"]);
      if (containers.has(type) && size > 8) { i += 8; continue; }
      i += size;
    }
    return result;
  } catch { return buf; }
}

function injectMp4FreeAtom(buf) {
  // Injeta átomo "free" com bytes aleatórios logo após o ftyp
  // Isso muda o hash do arquivo sem afetar nada no player/Instagram
  try {
    const rnd      = randBytes(32 + Math.floor(Math.random() * 32)); // 32~64 bytes aleatórios
    const freeAtom = Buffer.allocUnsafe(8 + rnd.length);
    freeAtom.writeUInt32BE(8 + rnd.length, 0);
    freeAtom.write("free", 4, "latin1");
    rnd.copy(freeAtom, 8);
    // Insere após o ftyp atom (primeiros N bytes)
    let ftypEnd = 0;
    if (buf.length > 8 && buf.slice(4, 8).toString("ascii") === "ftyp") {
      ftypEnd = buf.readUInt32BE(0);
    }
    return Buffer.concat([buf.slice(0, ftypEnd), freeAtom, buf.slice(ftypEnd)]);
  } catch { return buf; }
}

function processMp4(buf) {
  let result = removeMp4Metadata(buf);
  result = varyMp4Timestamps(result);
  result = injectMp4FreeAtom(result);
  return result;
}

// ─── WebM ─────────────────────────────────────────────────────────────────────
function processWebm(buf) {
  try {
    if (buf[0] !== 0x1A || buf[1] !== 0x45 || buf[2] !== 0xDF || buf[3] !== 0xA3) return buf;
    // Injeta elemento Void com bytes aleatórios no início
    const rnd  = randBytes(16);
    const void_ = Buffer.from([0xEC, 0x90, ...rnd]); // EBML Void element
    return Buffer.concat([buf.slice(0, 4), void_, buf.slice(4)]);
  } catch { return buf; }
}

// ─── Detecção de tipo ─────────────────────────────────────────────────────────
export function detectMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.length > 8 && buf.slice(4, 8).toString("ascii") === "ftyp") return "video/mp4";
  if (buf.length > 8 && buf.slice(4, 8).toString("ascii") === "moov") return "video/mp4";
  if (buf.length > 8 && buf.slice(4, 8).toString("ascii") === "mdat") return "video/mp4";
  if (buf[0] === 0x1A && buf[1] === 0x45) return "video/webm";
  return null;
}

// ─── API principal ────────────────────────────────────────────────────────────

// Chamado no upload inicial — limpa metadados uma vez
export function sanitizeMedia(buf, mimeType) {
  try {
    if (!buf || buf.length === 0) return buf;
    if (mimeType === "image/jpeg" || mimeType === "image/jpg") return processJpeg(buf);
    if (mimeType === "image/png")  return processPng(buf);
    if (mimeType === "image/webp") return processWebp(buf);
    if (mimeType === "video/webm") return processWebm(buf);
    // MP4: não modifica no upload — só na hora de postar por conta
    return buf;
  } catch { return buf; }
}

// Chamado por conta na hora de publicar — gera variação única de hash
// NÃO corta vídeo, NÃO modifica frames, NÃO recodifica
export function varyMediaForAccount(buf, mimeType) {
  try {
    if (!buf || buf.length === 0) return buf;
    if (mimeType === "video/mp4" || mimeType === "video/quicktime") return processMp4(buf);
    if (mimeType === "video/webm") return processWebm(buf);
    if (mimeType === "image/jpeg" || mimeType === "image/jpg") return processJpeg(buf);
    if (mimeType === "image/png")  return processPng(buf);
    if (mimeType === "image/webp") return processWebp(buf);
    // Fallback: injeta bytes aleatórios no final
    return Buffer.concat([buf, randBytes(32)]);
  } catch { return buf; }
}
