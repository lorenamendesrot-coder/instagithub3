// sanitize-media.mjs — limpeza e variação de metadados em Node puro (sem ffmpeg, sem sharp)
// Usado pelo publish.mjs para gerar uma versão única por conta antes de postar
import crypto from "crypto";

// ─── Utilitários ──────────────────────────────────────────────────────────────
function randomBytes(n) { return crypto.randomBytes(n); }
function randU32() { return crypto.randomBytes(4).readUInt32BE(0); }

// ─── JPEG ─────────────────────────────────────────────────────────────────────
// Remove APP1 (EXIF/XMP), APP2-APP15, APP13 (IPTC), injeta COM com bytes aleatórios
function sanitizeJpeg(buf) {
  try {
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return buf; // não é JPEG
    const out = [Buffer.from([0xFF, 0xD8])]; // SOI
    let i = 2;
    while (i < buf.length - 1) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const marker = buf[i + 1];
      // SOS (0xDA) — resto é dado de imagem, copia tudo
      if (marker === 0xDA) { out.push(buf.slice(i)); break; }
      // EOI (0xD9) — fim
      if (marker === 0xD9) { out.push(Buffer.from([0xFF, 0xD9])); break; }
      // Marcadores sem comprimento (RST0-RST7, SOI)
      if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0xD8) { out.push(buf.slice(i, i + 2)); i += 2; continue; }
      if (i + 3 >= buf.length) break;
      const segLen = buf.readUInt16BE(i + 2);
      const segEnd = i + 2 + segLen;
      // Remove: APP1 (EXIF/XMP), APP2-APP15 (ICC, etc), APP13 (IPTC)
      const drop = (marker === 0xE1) || (marker >= 0xE2 && marker <= 0xEF) || (marker === 0xED);
      if (!drop) out.push(buf.slice(i, segEnd));
      i = segEnd;
    }
    // Injeta marcador COM com 16 bytes aleatórios antes do primeiro segmento de imagem
    const rnd  = randomBytes(16);
    const com  = Buffer.allocUnsafe(4 + 16);
    com[0] = 0xFF; com[1] = 0xFE;
    com.writeUInt16BE(18, 2);
    rnd.copy(com, 4);
    out.splice(1, 0, com); // depois do SOI
    return Buffer.concat(out);
  } catch { return buf; }
}

// ─── PNG ──────────────────────────────────────────────────────────────────────
// Remove chunks tEXt, iTXt, zTXt, eXIf, iCCP, tIME; injeta chunk tEXt com valor aleatório
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
    // Injeta chunk tEXt com valor aleatório antes de IEND
    const key = Buffer.from("Comment\0");
    const val = randomBytes(16);
    const data = Buffer.concat([key, val]);
    const chunkBuf = Buffer.allocUnsafe(4 + 4 + data.length + 4);
    chunkBuf.writeUInt32BE(data.length, 0);
    chunkBuf.write("tEXt", 4, "ascii");
    data.copy(chunkBuf, 8);
    // CRC
    const crc = crc32(chunkBuf.slice(4, 8 + data.length));
    chunkBuf.writeUInt32BE(crc, 8 + data.length);
    // Insere antes do último chunk (IEND)
    out.splice(out.length - 1, 0, chunkBuf);
    return Buffer.concat(out);
  } catch { return buf; }
}

// CRC32 para PNG
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── WebP ─────────────────────────────────────────────────────────────────────
// Remove chunks EXIF e XMP ; injeta chunk UNKN com bytes aleatórios
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
      const total = 8 + size + (size % 2); // padding
      if (!DROP.has(type)) out.push(buf.slice(i, i + total));
      i += total;
    }
    // Injeta chunk UNKN com 16 bytes aleatórios
    const rnd = randomBytes(16);
    const chunk = Buffer.allocUnsafe(8 + 16);
    chunk.write("UNKN", 0, "ascii");
    chunk.writeUInt32LE(16, 4);
    rnd.copy(chunk, 8);
    out.push(chunk);
    // Atualiza RIFF size
    const result = Buffer.concat(out);
    result.writeUInt32LE(result.length - 8, 4);
    return result;
  } catch { return buf; }
}

// ─── MP4 / MOV ────────────────────────────────────────────────────────────────
// Zera átomos udta, meta, ©nam, ©art, ©day, ©too, ©cmt trocando tipo para "free"
// Injeta átomo "free" com bytes aleatórios no nível raiz
function sanitizeMp4(buf) {
  try {
    const META_ATOMS = new Set(["udta","meta","©nam","©art","©day","©too","©cmt","©alb","©gen","desc","cprt"]);
    const result = Buffer.from(buf); // cópia mutável
    let i = 0;
    while (i < result.length - 8) {
      const size = result.readUInt32BE(i);
      if (size < 8 || i + size > result.length) break;
      const type = result.slice(i+4, i+8).toString("latin1");
      if (META_ATOMS.has(type)) {
        // Troca tipo para "free" e zera conteúdo
        result.write("free", i+4, "latin1");
        result.fill(0, i+8, i+size);
      }
      // Entra em átomos container (moov, trak, mdia, minf, stbl, ilst)
      const CONTAINERS = new Set(["moov","trak","mdia","minf","stbl","ilst","udta"]);
      if (CONTAINERS.has(type) && size > 8) {
        // recursão inline: já percorremos o conteúdo na próxima iteração do while
        i += 8; continue;
      }
      i += size;
    }
    // Injeta átomo "free" de 24 bytes com bytes aleatórios no início do buffer (após ftyp)
    const rnd = randomBytes(16);
    const freeAtom = Buffer.allocUnsafe(24);
    freeAtom.writeUInt32BE(24, 0);
    freeAtom.write("free", 4, "latin1");
    rnd.copy(freeAtom, 8);
    // Encontra fim do átomo ftyp para inserir depois
    let ftypEnd = 0;
    if (result.slice(4,8).toString("ascii") === "ftyp") {
      ftypEnd = result.readUInt32BE(0);
    }
    return Buffer.concat([result.slice(0, ftypEnd), freeAtom, result.slice(ftypEnd)]);
  } catch { return buf; }
}

// ─── WebM ─────────────────────────────────────────────────────────────────────
// Adiciona elemento Void (ID 0xEC) com bytes aleatórios no início do segmento
function sanitizeWebm(buf) {
  try {
    if (buf[0] !== 0x1A || buf[1] !== 0x45 || buf[2] !== 0xDF || buf[3] !== 0xA3) return buf;
    // Injeta elemento Void de 20 bytes logo após o header EBML
    const rnd  = randomBytes(16);
    const void_ = Buffer.from([0xEC, 0x90, ...rnd]); // 0xEC=Void ID, 0x90=tamanho 16
    return Buffer.concat([buf.slice(0, 4), void_, buf.slice(4)]);
  } catch { return buf; }
}

// ─── Exportação principal ─────────────────────────────────────────────────────
export function sanitizeMedia(buf, mimeType) {
  try {
    if (mimeType === "image/jpeg" || mimeType === "image/jpg") return sanitizeJpeg(buf);
    if (mimeType === "image/png")  return sanitizePng(buf);
    if (mimeType === "image/webp") return sanitizeWebp(buf);
    if (mimeType === "video/mp4" || mimeType === "video/quicktime") return sanitizeMp4(buf);
    if (mimeType === "video/webm") return sanitizeWebm(buf);
    // Para outros tipos: injeta bytes aleatórios no final (fallback seguro)
    return Buffer.concat([buf, randomBytes(32)]);
  } catch {
    return buf; // fallback: retorna original se qualquer parsing falhar
  }
}

// Detecta mimeType pelo magic bytes
export function detectMime(buf) {
  if (buf[0]===0xFF && buf[1]===0xD8) return "image/jpeg";
  if (buf[0]===0x89 && buf[1]===0x50) return "image/png";
  if (buf.slice(0,4).toString()=="RIFF" && buf.slice(8,12).toString()=="WEBP") return "image/webp";
  if (buf.slice(4,8).toString()=="ftyp" || buf.slice(4,8).toString()=="moov") return "video/mp4";
  if (buf.slice(4,8).toString()=="wide" || buf.slice(4,8).toString()=="mdat") return "video/mp4";
  if (buf[0]===0x1A && buf[1]===0x45) return "video/webm";
  return null;
}
