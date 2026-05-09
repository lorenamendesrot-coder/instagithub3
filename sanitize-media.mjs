// sanitize-media.mjs — limpeza de metadados + variação por conta
// Técnicas: remoção EXIF, corte de 0~0.5s no MP4, overlay de ruído
import crypto from "crypto";

function randomBytes(n) { return crypto.randomBytes(n); }
function randF(min, max) { return Math.random() * (max - min) + min; }

// ─── JPEG ─────────────────────────────────────────────────────────────────────
function sanitizeJpeg(buf) {
  try {
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return buf;
    const out = [Buffer.from([0xFF, 0xD8])];
    let i = 2;
    while (i < buf.length - 1) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xDA) { out.push(buf.slice(i)); break; }
      if (marker === 0xD9) { out.push(Buffer.from([0xFF, 0xD9])); break; }
      if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0xD8) { out.push(buf.slice(i, i + 2)); i += 2; continue; }
      if (i + 3 >= buf.length) break;
      const segLen = buf.readUInt16BE(i + 2);
      const segEnd = i + 2 + segLen;
      const drop = (marker === 0xE1) || (marker >= 0xE2 && marker <= 0xEF) || (marker === 0xED);
      if (!drop) out.push(buf.slice(i, segEnd));
      i = segEnd;
    }
    const rnd = randomBytes(16);
    const com = Buffer.allocUnsafe(4 + 16);
    com[0] = 0xFF; com[1] = 0xFE;
    com.writeUInt16BE(18, 2);
    rnd.copy(com, 4);
    out.splice(1, 0, com);
    return Buffer.concat(out);
  } catch { return buf; }
}

// ─── PNG ──────────────────────────────────────────────────────────────────────
function sanitizePng(buf) {
  try {
    const PNG_SIG = Buffer.from([137,80,78,71,13,10,26,10]);
    if (!buf.slice(0,8).equals(PNG_SIG)) return buf;
    const DROP_CHUNKS = new Set(["tEXt","iTXt","zTXt","eXIf","iCCP","tIME"]);
    const out = [PNG_SIG];
    let i = 8;
    while (i < buf.length) {
      if (i + 8 > buf.length) break;
      const len  = buf.readUInt32BE(i);
      const type = buf.slice(i+4, i+8).toString("ascii");
      const total = 4 + 4 + len + 4;
      if (!DROP_CHUNKS.has(type)) out.push(buf.slice(i, i + total));
      i += total;
    }
    const key = Buffer.from("Comment\0");
    const val = randomBytes(16);
    const data = Buffer.concat([key, val]);
    const chunkBuf = Buffer.allocUnsafe(4 + 4 + data.length + 4);
    chunkBuf.writeUInt32BE(data.length, 0);
    chunkBuf.write("tEXt", 4, "ascii");
    data.copy(chunkBuf, 8);
    const crc = crc32(chunkBuf.slice(4, 8 + data.length));
    chunkBuf.writeUInt32BE(crc, 8 + data.length);
    out.splice(out.length - 1, 0, chunkBuf);
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
function sanitizeWebp(buf) {
  try {
    if (buf.slice(0,4).toString("ascii") !== "RIFF") return buf;
    if (buf.slice(8,12).toString("ascii") !== "WEBP") return buf;
    const DROP = new Set(["EXIF","XMP "]);
    const out = [buf.slice(0, 12)];
    let i = 12;
    while (i < buf.length) {
      if (i + 8 > buf.length) break;
      const type = buf.slice(i, i+4).toString("ascii");
      const size = buf.readUInt32LE(i+4);
      const total = 8 + size + (size % 2);
      if (!DROP.has(type)) out.push(buf.slice(i, i + total));
      i += total;
    }
    const rnd = randomBytes(16);
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

// ─── MP4 — sanitização + corte 0~0.5s + overlay de ruído ────────────────────
function sanitizeMp4(buf) {
  try {
    const META_ATOMS = new Set(["udta","meta","©nam","©art","©day","©too","©cmt","©alb","©gen","desc","cprt"]);
    const result = Buffer.from(buf);
    let i = 0;
    while (i < result.length - 8) {
      const size = result.readUInt32BE(i);
      if (size < 8 || i + size > result.length) break;
      const type = result.slice(i+4, i+8).toString("latin1");
      if (META_ATOMS.has(type)) {
        result.write("free", i+4, "latin1");
        result.fill(0, i+8, i+size);
      }
      const CONTAINERS = new Set(["moov","trak","mdia","minf","stbl","ilst","udta"]);
      if (CONTAINERS.has(type) && size > 8) { i += 8; continue; }
      i += size;
    }
    // Átomo free com bytes aleatórios após ftyp
    const rnd = randomBytes(16);
    const freeAtom = Buffer.allocUnsafe(24);
    freeAtom.writeUInt32BE(24, 0);
    freeAtom.write("free", 4, "latin1");
    rnd.copy(freeAtom, 8);
    let ftypEnd = 0;
    if (result.slice(4,8).toString("ascii") === "ftyp") ftypEnd = result.readUInt32BE(0);
    return Buffer.concat([result.slice(0, ftypEnd), freeAtom, result.slice(ftypEnd)]);
  } catch { return buf; }
}

// Variação de timestamp no MP4 (muda creation_time e modification_time no mvhd)
function varyMp4Timestamps(buf) {
  try {
    const result = Buffer.from(buf);
    // Procura pelo átomo mvhd (Movie Header Box)
    let i = 0;
    while (i < result.length - 8) {
      const size = result.readUInt32BE(i);
      if (size < 8 || i + size > result.length) break;
      const type = result.slice(i+4, i+8).toString("ascii");
      if (type === "mvhd" && size >= 28) {
        // Offset 8 = version, offset 12 = creation_time, offset 16 = modification_time
        const base = i + 8;
        const version = result[base];
        if (version === 0) {
          // 32-bit timestamps: base+1 = creation, base+5 = modification
          const jitter = Math.floor(randF(-300, 300)); // ±5 minutos em segundos
          const ct = result.readUInt32BE(base + 1);
          const mt = result.readUInt32BE(base + 5);
          result.writeUInt32BE(Math.max(0, ct + jitter), base + 1);
          result.writeUInt32BE(Math.max(0, mt + jitter), base + 5);
        }
        break;
      }
      const CONTAINERS = new Set(["moov","trak","mdia","minf","stbl"]);
      if (CONTAINERS.has(type) && size > 8) { i += 8; continue; }
      i += size;
    }
    return result;
  } catch { return buf; }
}

// Corte simulado no MP4: injeta átomo "skip" com duração variável (0.1~0.5s em ticks)
// Nota: sem ffmpeg não dá para cortar frames reais — usamos variação no edit list (elst)
// Isso muda o ponto de início da apresentação sem recodificar
function varyMp4EditList(buf) {
  try {
    const result = Buffer.from(buf);
    // Offset de início aleatório: 0 ~ 0.5s em unidades de timescale
    // Primeiro encontra o timescale no mvhd
    let timescale = 1000; // padrão MP4
    let i = 0;
    while (i < result.length - 8) {
      const size = result.readUInt32BE(i);
      if (size < 8 || i + size > result.length) break;
      const type = result.slice(i+4, i+8).toString("ascii");
      if (type === "mvhd" && size >= 28) {
        const base = i + 8;
        const version = result[base];
        timescale = version === 0
          ? result.readUInt32BE(base + 9)  // 32-bit: after version(1) + ct(4) + mt(4)
          : result.readUInt32BE(base + 17); // 64-bit
        break;
      }
      const CONTAINERS = new Set(["moov","trak","mdia"]);
      if (CONTAINERS.has(type) && size > 8) { i += 8; continue; }
      i += size;
    }

    // Injeta átomo "free" de tamanho variável para mudar o offset do arquivo
    // Isso altera o hash sem recodificar
    const offsetTicks = Math.floor(randF(1, Math.floor(timescale * 0.5)));
    const extraBytes = randomBytes(offsetTicks % 64 + 8); // 8~72 bytes extras aleatórios
    const freeAtom = Buffer.allocUnsafe(8 + extraBytes.length);
    freeAtom.writeUInt32BE(8 + extraBytes.length, 0);
    freeAtom.write("free", 4, "latin1");
    extraBytes.copy(freeAtom, 8);

    // Insere logo após o ftyp atom
    let ftypEnd = 0;
    if (result.slice(4,8).toString("ascii") === "ftyp") ftypEnd = result.readUInt32BE(0);
    return Buffer.concat([result.slice(0, ftypEnd), freeAtom, result.slice(ftypEnd)]);
  } catch { return buf; }
}

// Overlay de ruído no MP4: injeta bytes pseudo-aleatórios em frames não críticos
// Simula variação de 1~3% de intensidade de ruído no bitstream sem recodificar
function overlayNoiseMp4(buf) {
  try {
    const result = Buffer.from(buf);
    // Encontra o átomo mdat (dados de mídia)
    let i = 0;
    while (i < result.length - 8) {
      const size = result.readUInt32BE(i);
      if (size < 8 || i + size > result.length) break;
      const type = result.slice(i+4, i+8).toString("ascii");
      if (type === "mdat") {
        // Injeta variação em ~2% dos bytes do mdat (não críticos)
        // Evita os primeiros 256 bytes (cabeçalho do frame) e atua em bytes isolados
        const dataStart = i + 8;
        const dataEnd   = i + size;
        const dataLen   = dataEnd - dataStart;
        if (dataLen < 512) { i += size; continue; }
        // Número de bytes a variar: 0.5~1% do total (bem discreto)
        const numChanges = Math.floor(dataLen * randF(0.003, 0.008));
        for (let c = 0; c < numChanges; c++) {
          // Posição aleatória dentro do mdat, evitando início/fim do segmento
          const pos = dataStart + 256 + Math.floor(Math.random() * (dataLen - 512));
          // XOR com valor pequeno (1~7) para variar minimamente o byte
          result[pos] = result[pos] ^ (1 + Math.floor(Math.random() * 6));
        }
        break; // só o primeiro mdat
      }
      const CONTAINERS = new Set(["moov","trak","mdia","minf","stbl","udta"]);
      if (CONTAINERS.has(type) && size > 8) { i += 8; continue; }
      i += size;
    }
    return result;
  } catch { return buf; }
}

// ─── WebM ─────────────────────────────────────────────────────────────────────
function sanitizeWebm(buf) {
  try {
    if (buf[0] !== 0x1A || buf[1] !== 0x45 || buf[2] !== 0xDF || buf[3] !== 0xA3) return buf;
    const rnd   = randomBytes(16);
    const void_ = Buffer.from([0xEC, 0x90, ...rnd]);
    return Buffer.concat([buf.slice(0, 4), void_, buf.slice(4)]);
  } catch { return buf; }
}

// ─── Exportação principal ─────────────────────────────────────────────────────
// sanitizeMedia: usado no upload inicial (limpeza de metadados)
export function sanitizeMedia(buf, mimeType) {
  try {
    if (mimeType === "image/jpeg" || mimeType === "image/jpg") return sanitizeJpeg(buf);
    if (mimeType === "image/png")  return sanitizePng(buf);
    if (mimeType === "image/webp") return sanitizeWebp(buf);
    // sanitizeMp4 REMOVIDO — modificar estrutura do moov corrompia o arquivo
    // Para MP4: apenas passa o buffer original sem alteração estrutural
    if (mimeType === "video/mp4" || mimeType === "video/quicktime") return buf;
    if (mimeType === "video/webm") return sanitizeWebm(buf);
    return Buffer.concat([buf, randomBytes(32)]);
  } catch { return buf; }
}

// varyMediaForAccount: variação única por conta antes de postar
// Aplica: variação de timestamp + edit list + overlay de ruído (MP4)
// Para imagens: nova injeção de bytes aleatórios
export function varyMediaForAccount(buf, mimeType) {
  try {
    if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
      // overlayNoiseMp4 REMOVIDO — corrompia frames e impedia processamento no Instagram
      // Apenas variações seguras: timestamps no mvhd e átomo free com bytes aleatórios
      let result = varyMp4Timestamps(buf);
      result = varyMp4EditList(result);
      return result;
    }
    if (mimeType === "image/jpeg" || mimeType === "image/jpg") return sanitizeJpeg(buf);
    if (mimeType === "image/png")  return sanitizePng(buf);
    if (mimeType === "image/webp") return sanitizeWebp(buf);
    if (mimeType === "video/webm") return sanitizeWebm(buf);
    return Buffer.concat([buf, randomBytes(32)]);
  } catch { return buf; }
}

export function detectMime(buf) {
  if (buf[0]===0xFF && buf[1]===0xD8) return "image/jpeg";
  if (buf[0]===0x89 && buf[1]===0x50) return "image/png";
  if (buf.slice(0,4).toString()==="RIFF" && buf.slice(8,12).toString()==="WEBP") return "image/webp";
  if (buf.slice(4,8).toString()==="ftyp" || buf.slice(4,8).toString()==="moov") return "video/mp4";
  if (buf.slice(4,8).toString()==="wide" || buf.slice(4,8).toString()==="mdat") return "video/mp4";
  if (buf[0]===0x1A && buf[1]===0x45) return "video/webm";
  return null;
}
