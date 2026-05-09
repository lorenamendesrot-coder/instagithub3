// sanitizeClient.js — Sanitização de mídia no BROWSER (client-side)
// Portado do sanitize-media.mjs (Node) para rodar com ArrayBuffer/Uint8Array
// Técnicas: remoção EXIF/XMP/metadados, injeção de bytes aleatórios únicos
// Compatível com: JPEG, PNG, WebP, MP4/MOV
// Retorna: { file: File, report: SanitizationReport }

// ─── Utilitários ──────────────────────────────────────────────────────────────

function randomBytes(n) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}

function randomHex(n) {
  return Array.from(randomBytes(n)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function readU16BE(buf, offset) {
  return (buf[offset] << 8) | buf[offset + 1];
}

function readU32BE(buf, offset) {
  return ((buf[offset] << 24) | (buf[offset+1] << 16) | (buf[offset+2] << 8) | buf[offset+3]) >>> 0;
}

function readU32LE(buf, offset) {
  return ((buf[offset+3] << 24) | (buf[offset+2] << 16) | (buf[offset+1] << 8) | buf[offset]) >>> 0;
}

function writeU32BE(buf, offset, val) {
  buf[offset]   = (val >>> 24) & 0xFF;
  buf[offset+1] = (val >>> 16) & 0xFF;
  buf[offset+2] = (val >>> 8)  & 0xFF;
  buf[offset+3] =  val         & 0xFF;
}

function concatUint8Arrays(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) { result.set(arr, offset); offset += arr.length; }
  return result;
}

function asciiBytes(str) {
  return new Uint8Array([...str].map(c => c.charCodeAt(0)));
}

function readAscii(buf, offset, len) {
  return Array.from(buf.slice(offset, offset + len)).map(b => String.fromCharCode(b)).join("");
}

// ─── CRC32 (para PNG) ─────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── JPEG ─────────────────────────────────────────────────────────────────────
// Remove: APP1 (EXIF/XMP), APP2–APP15 (ICC, etc.), APP13 (IPTC)
// Injeta: marcador COM com 16 bytes aleatórios únicos

function sanitizeJpeg(buf) {
  const removed = [];
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return { buf, removed: ["não é JPEG válido"] };

  const out = [new Uint8Array([0xFF, 0xD8])]; // SOI
  let i = 2;

  while (i < buf.length - 1) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];

    // SOS — restante são dados de imagem, copia tudo
    if (marker === 0xDA) { out.push(buf.slice(i)); break; }
    // EOI
    if (marker === 0xD9) { out.push(new Uint8Array([0xFF, 0xD9])); break; }
    // Marcadores sem comprimento
    if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0xD8) { out.push(buf.slice(i, i + 2)); i += 2; continue; }

    if (i + 3 >= buf.length) break;
    const segLen = readU16BE(buf, i + 2);
    const segEnd = i + 2 + segLen;

    const isApp1  = marker === 0xE1; // EXIF / XMP
    const isApp13 = marker === 0xED; // IPTC
    const isApp2to15 = marker >= 0xE2 && marker <= 0xEF; // ICC, etc.

    if (isApp1)  { removed.push("EXIF/XMP (APP1)"); i = segEnd; continue; }
    if (isApp13) { removed.push("IPTC (APP13)");    i = segEnd; continue; }
    if (isApp2to15) { removed.push(`APP${marker - 0xE0}`); i = segEnd; continue; }

    out.push(buf.slice(i, segEnd));
    i = segEnd;
  }

  // Injeta marcador COM com 16 bytes aleatórios
  const rnd = randomBytes(16);
  const com = new Uint8Array(4 + 16);
  com[0] = 0xFF; com[1] = 0xFE;
  com[2] = 0; com[3] = 18; // length = 2 + 16
  com.set(rnd, 4);
  out.splice(1, 0, com);
  removed.push("injeção COM com hash único");

  return { buf: concatUint8Arrays(out), removed };
}

// ─── PNG ──────────────────────────────────────────────────────────────────────
// Remove: tEXt, iTXt, zTXt, eXIf, iCCP, tIME
// Injeta: chunk tEXt com bytes aleatórios

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_DROP_CHUNKS = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "iCCP", "tIME"]);

function sanitizePng(buf) {
  const removed = [];
  for (let s = 0; s < 8; s++) {
    if (buf[s] !== PNG_SIG[s]) return { buf, removed: ["não é PNG válido"] };
  }

  const out = [buf.slice(0, 8)]; // PNG signature
  let i = 8;

  while (i < buf.length) {
    if (i + 8 > buf.length) break;
    const len  = readU32BE(buf, i);
    const type = readAscii(buf, i + 4, 4);
    const total = 4 + 4 + len + 4; // length + type + data + crc

    if (PNG_DROP_CHUNKS.has(type)) { removed.push(type); i += total; continue; }
    out.push(buf.slice(i, i + total));
    i += total;
  }

  // Injeta chunk tEXt com "Comment\0" + 16 bytes aleatórios
  const key     = asciiBytes("Comment\0");
  const val     = randomBytes(16);
  const data    = concatUint8Arrays([key, val]);
  const typeArr = asciiBytes("tEXt");
  const lenBuf  = new Uint8Array(4);
  writeU32BE(lenBuf, 0, data.length);

  const crcInput = concatUint8Arrays([typeArr, data]);
  const crcVal   = crc32(crcInput);
  const crcBuf   = new Uint8Array(4);
  writeU32BE(crcBuf, 0, crcVal);

  const chunk = concatUint8Arrays([lenBuf, typeArr, data, crcBuf]);
  // Insere antes do IEND
  out.splice(out.length - 1, 0, chunk);
  removed.push("injeção tEXt com hash único");

  return { buf: concatUint8Arrays(out), removed };
}

// ─── WebP ─────────────────────────────────────────────────────────────────────
// Remove: EXIF, XMP_
// Injeta: chunk UNKN com bytes aleatórios

const WEBP_DROP_CHUNKS = new Set(["EXIF", "XMP "]);

function sanitizeWebp(buf) {
  const removed = [];
  const riff = readAscii(buf, 0, 4);
  const webp = readAscii(buf, 8, 4);
  if (riff !== "RIFF" || webp !== "WEBP") return { buf, removed: ["não é WebP válido"] };

  const out = [buf.slice(0, 12)]; // RIFF header
  let i = 12;

  while (i < buf.length) {
    if (i + 8 > buf.length) break;
    const type  = readAscii(buf, i, 4);
    const size  = readU32LE(buf, i + 4);
    const total = 8 + size + (size % 2);
    if (WEBP_DROP_CHUNKS.has(type)) { removed.push(type); i += total; continue; }
    out.push(buf.slice(i, i + total));
    i += total;
  }

  // Injeta chunk UNKN com 16 bytes aleatórios
  const rnd = randomBytes(16);
  const unkn = new Uint8Array(8 + 16);
  unkn.set(asciiBytes("UNKN"), 0);
  unkn[4] = 16; unkn[5] = 0; unkn[6] = 0; unkn[7] = 0; // size LE
  unkn.set(rnd, 8);
  out.push(unkn);
  removed.push("injeção UNKN com hash único");

  // Recalcular tamanho RIFF
  const result = concatUint8Arrays(out);
  writeU32BE(result, 4, result.length - 8); // não é LE aqui? WebP usa LE
  // WebP RIFF size é LE — corrigir
  const totalSize = result.length - 8;
  result[4] =  totalSize        & 0xFF;
  result[5] = (totalSize >> 8)  & 0xFF;
  result[6] = (totalSize >> 16) & 0xFF;
  result[7] = (totalSize >> 24) & 0xFF;

  return { buf: result, removed };
}

// ─── MP4 / MOV ────────────────────────────────────────────────────────────────
// Remove atoms de metadados: udta, meta, ©nam, ©art, ©day, ©too, etc.
// Injeta: atom "uuid" com 16 bytes aleatórios no nível raiz

const MP4_META_ATOMS = new Set(["udta", "meta", "©nam", "©art", "©day", "©too", "©cmt", "©alb", "©gen", "desc", "cprt", "free"]);
const MP4_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "ilst"]);

function sanitizeMp4(buf) {
  const removed = [];

  // Percorre os atoms do nível raiz e dos containers
  function processAtoms(src, depth = 0) {
    const chunks = [];
    let i = 0;

    while (i < src.length) {
      if (i + 8 > src.length) { chunks.push(src.slice(i)); break; }

      let size = readU32BE(src, i);
      if (size === 0) { chunks.push(src.slice(i)); break; } // atom vai até EOF
      if (size < 8 || i + size > src.length + 4) { chunks.push(src.slice(i)); break; }

      const type = readAscii(src, i + 4, 4);

      if (depth === 0 && MP4_META_ATOMS.has(type)) {
        removed.push(type);
        i += size;
        continue;
      }

      if (MP4_CONTAINERS.has(type) && size > 8) {
        // Processa recursivamente o interior do container
        const inner    = src.slice(i + 8, i + size);
        const cleaned  = processAtoms(inner, depth + 1);
        const newSize  = 8 + cleaned.length;
        const header   = new Uint8Array(8);
        writeU32BE(header, 0, newSize);
        header.set(asciiBytes(type), 4);
        chunks.push(concatUint8Arrays([header, cleaned]));
        i += size;
        continue;
      }

      chunks.push(src.slice(i, i + size));
      i += size;
    }

    return concatUint8Arrays(chunks);
  }

  const cleaned = processAtoms(buf);

  // Injeta atom "uuid" com 16 bytes aleatórios no final (antes do mdat ou no fim)
  const rnd = randomBytes(16);
  const uuidAtom = new Uint8Array(8 + 16);
  writeU32BE(uuidAtom, 0, 24); // size
  uuidAtom.set(asciiBytes("uuid"), 4);
  uuidAtom.set(rnd, 8);

  removed.push("injeção uuid com hash único");

  return {
    buf: concatUint8Arrays([cleaned, uuidAtom]),
    removed,
  };
}

// ─── Detector de formato ──────────────────────────────────────────────────────

function detectFormat(buf, mimeType) {
  if (buf[0] === 0xFF && buf[1] === 0xD8) return "jpeg";
  if (buf[0] === 137  && buf[1] === 80)  return "png";
  if (readAscii(buf, 0, 4) === "RIFF" && readAscii(buf, 8, 4) === "WEBP") return "webp";

  // ftyp atom em MP4/MOV
  if (buf.length > 12) {
    const ftyp = readAscii(buf, 4, 4);
    if (ftyp === "ftyp" || ftyp === "moov" || ftyp === "mdat") return "mp4";
  }

  // Fallback por mime type
  if (mimeType?.includes("jpeg"))     return "jpeg";
  if (mimeType?.includes("png"))      return "png";
  if (mimeType?.includes("webp"))     return "webp";
  if (mimeType?.includes("mp4"))      return "mp4";
  if (mimeType?.includes("quicktime"))return "mp4";
  if (mimeType?.includes("video"))    return "mp4";

  return "unknown";
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Sanitiza um File no browser.
 * Retorna um novo File com os metadados removidos e bytes únicos injetados,
 * junto com um relatório detalhado do que foi feito.
 *
 * @param {File} file
 * @returns {Promise<{ file: File, report: object }>}
 */
export async function sanitizeFile(file) {
  const startMs  = performance.now();
  const arrayBuf = await file.arrayBuffer();
  const original = new Uint8Array(arrayBuf);
  const uniqueId = randomHex(8); // ID único por arquivo sanitizado

  const format = detectFormat(original, file.type);
  let result   = { buf: original, removed: [] };

  if (format === "jpeg") result = sanitizeJpeg(original);
  else if (format === "png")  result = sanitizePng(original);
  else if (format === "webp") result = sanitizeWebp(original);
  else if (format === "mp4")  result = sanitizeMp4(original);
  // outros formatos: retorna sem modificação mas documenta

  const durationMs = Math.round(performance.now() - startMs);
  const sizeDiff   = result.buf.length - original.length;

  // Gera novo nome com sufixo único para evitar hash igual
  const ext      = file.name.split(".").pop();
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const newName  = `${baseName}_s${uniqueId}.${ext}`;

  // Cria novo File com o buffer sanitizado
  const sanitized = new File([result.buf], newName, { type: file.type, lastModified: Date.now() });

  const report = {
    originalName:  file.name,
    sanitizedName: newName,
    format,
    uniqueId,
    originalSize:  original.length,
    sanitizedSize: result.buf.length,
    sizeDiff,
    removed:       result.removed,
    durationMs,
    sanitizedAt:   new Date().toISOString(),
    supported:     format !== "unknown",
  };

  return { file: sanitized, report };
}

/**
 * Retorna um resumo legível do relatório de sanitização
 */
export function formatReport(report) {
  if (!report) return "—";
  const lines = [
    `Formato: ${report.format.toUpperCase()}`,
    `ID único: ${report.uniqueId}`,
    `Tamanho: ${(report.originalSize / 1024).toFixed(0)} KB → ${(report.sanitizedSize / 1024).toFixed(0)} KB (${report.sizeDiff >= 0 ? "+" : ""}${report.sizeDiff}B)`,
    `Removido/injetado: ${report.removed.join(", ") || "nenhum"}`,
    `Tempo: ${report.durationMs}ms`,
  ];
  return lines.join("\n");
}
