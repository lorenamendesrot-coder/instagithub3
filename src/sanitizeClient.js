// sanitizeClient.js — Sanitização de mídia no BROWSER (client-side)
// Técnicas: remoção EXIF/XMP/metadados + variação única por conta
// Cada conta recebe um arquivo com fingerprint diferente:
//   - Metadados aleatórios distintos (COM, tEXt, uuid)
//   - Timestamps diferentes no JPEG/PNG/MP4
//   - Ruído de 1-2 pixels em posição aleatória (JPEG/PNG)
//   - Tamanho de arquivo ligeiramente diferente
// Compatível com: JPEG, PNG, WebP, MP4/MOV

// ─── Utilitários ──────────────────────────────────────────────────────────────

function randomBytes(n, seed) {
  const arr = new Uint8Array(n);
  if (seed == null) {
    crypto.getRandomValues(arr);
  } else {
    // PRNG determinístico por seed (para variação por conta)
    let s = seed >>> 0;
    for (let i = 0; i < n; i++) {
      s = Math.imul(1664525, s) + 1013904223;
      arr[i] = (s >>> 24) & 0xFF;
    }
  }
  return arr;
}

function randomHex(n, seed) {
  return Array.from(randomBytes(n, seed))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Gera seed numérica a partir de accountId (string)
function accountSeed(accountId) {
  if (!accountId) return Math.random() * 0xFFFFFFFF >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < accountId.length; i++) {
    h ^= accountId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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
  return Array.from(buf.slice(offset, offset + len))
    .map(b => String.fromCharCode(b)).join("");
}

// Timestamp Unix aleatório nos últimos 2 anos (varia por conta)
function randomTimestamp(seed) {
  const now      = Math.floor(Date.now() / 1000);
  const twoYears = 2 * 365 * 24 * 3600;
  const s        = randomBytes(4, seed);
  const offset   = readU32BE(s, 0) % twoYears;
  return now - offset;
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
// Injeta por conta: marcador COM com metadados únicos + ruído de pixel

function sanitizeJpeg(buf, seed, addPixelNoise) {
  const removed = [];
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return { buf, removed: ["não é JPEG válido"] };

  // Copiar buffer para permitir modificação (ruído de pixel)
  const work = new Uint8Array(buf);

  const out = [new Uint8Array([0xFF, 0xD8])];
  let i = 2;
  let sosOffset = -1;

  while (i < work.length - 1) {
    if (work[i] !== 0xFF) { i++; continue; }
    const marker = work[i + 1];

    if (marker === 0xDA) {
      sosOffset = i;
      out.push(work.slice(i));
      break;
    }
    if (marker === 0xD9) { out.push(new Uint8Array([0xFF, 0xD9])); break; }
    if ((marker >= 0xD0 && marker <= 0xD7) || marker === 0xD8) {
      out.push(work.slice(i, i + 2)); i += 2; continue;
    }

    if (i + 3 >= work.length) break;
    const segLen = readU16BE(work, i + 2);
    const segEnd = i + 2 + segLen;

    const isApp1     = marker === 0xE1;
    const isApp13    = marker === 0xED;
    const isApp2to15 = marker >= 0xE2 && marker <= 0xEF;

    if (isApp1)      { removed.push("EXIF/XMP (APP1)"); i = segEnd; continue; }
    if (isApp13)     { removed.push("IPTC (APP13)");    i = segEnd; continue; }
    if (isApp2to15)  { removed.push(`APP${marker - 0xE0}`); i = segEnd; continue; }

    out.push(work.slice(i, segEnd));
    i = segEnd;
  }

  // ── Injetar marcador COM com metadados únicos por conta ─────────────────
  // Contém: hash único + timestamp + seed da conta (cada conta tem valores diferentes)
  const ts       = randomTimestamp(seed);
  const hashBytes = randomBytes(12, seed ^ 0xDEAD);
  const comData  = new Uint8Array(20);
  comData.set(hashBytes, 0);
  writeU32BE(comData, 12, ts);
  comData.set(randomBytes(4, seed ^ 0xBEEF), 16);

  const com = new Uint8Array(4 + 20);
  com[0] = 0xFF; com[1] = 0xFE;
  com[2] = 0; com[3] = 22; // length = 2 + 20
  com.set(comData, 4);
  out.splice(1, 0, com);
  removed.push(`injeção COM único (ts:${ts}, hash:${randomHex(4, seed)})`);

  // ── Ruído de 1-3 pixels em posição pseudoaleatória (via seed da conta) ──
  // Apenas se o SOS foi encontrado e addPixelNoise está habilitado
  if (addPixelNoise && sosOffset > 0) {
    const assembled = concatUint8Arrays(out);
    // Encontrar posição do SOS no buffer assembado
    const noiseSeed = seed ^ 0xCAFE;
    const noiseBytes = randomBytes(6, noiseSeed);
    // Modificar 2-4 bytes na região de dados (após o SOS header, que tem ~12 bytes)
    const sosInAssembled = assembled.findIndex((_, idx, arr) =>
      idx > 0 && arr[idx-1] === 0xFF && arr[idx] === 0xDA
    );
    if (sosInAssembled > 0) {
      const dataStart = sosInAssembled + 12;
      const dataEnd   = assembled.length - 2;
      if (dataEnd > dataStart + 100) {
        const range  = dataEnd - dataStart - 10;
        const pos1   = dataStart + (readU32BE(noiseBytes, 0) % range);
        const pos2   = dataStart + (readU32BE(noiseBytes, 2) % range);
        // XOR com valor não-zero pequeno (±1 no valor do byte)
        assembled[pos1] ^= (noiseBytes[4] & 0x03) + 1;
        assembled[pos2] ^= (noiseBytes[5] & 0x03) + 1;
        removed.push("ruído de pixel (2 bytes variados)");
      }
    }
    return { buf: assembled, removed };
  }

  return { buf: concatUint8Arrays(out), removed };
}

// ─── PNG ──────────────────────────────────────────────────────────────────────
// Remove: tEXt, iTXt, zTXt, eXIf, iCCP, tIME
// Injeta por conta: chunk tEXt com metadados únicos + chunk tIME com timestamp variável

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_DROP_CHUNKS = new Set(["tEXt", "iTXt", "zTXt", "eXIf", "iCCP", "tIME"]);

function makePngChunk(type, data) {
  const typeArr = asciiBytes(type);
  const lenBuf  = new Uint8Array(4);
  writeU32BE(lenBuf, 0, data.length);
  const crcInput = concatUint8Arrays([typeArr, data]);
  const crcVal   = crc32(crcInput);
  const crcBuf   = new Uint8Array(4);
  writeU32BE(crcBuf, 0, crcVal);
  return concatUint8Arrays([lenBuf, typeArr, data, crcBuf]);
}

function sanitizePng(buf, seed) {
  const removed = [];
  for (let s = 0; s < 8; s++) {
    if (buf[s] !== PNG_SIG[s]) return { buf, removed: ["não é PNG válido"] };
  }

  const out = [buf.slice(0, 8)];
  let i = 8;

  while (i < buf.length) {
    if (i + 8 > buf.length) break;
    const len   = readU32BE(buf, i);
    const type  = readAscii(buf, i + 4, 4);
    const total = 4 + 4 + len + 4;
    if (PNG_DROP_CHUNKS.has(type)) { removed.push(type); i += total; continue; }
    out.push(buf.slice(i, i + total));
    i += total;
  }

  // tEXt com metadados únicos por conta
  const key     = asciiBytes("Comment\0");
  const val     = randomBytes(20, seed);            // 20 bytes únicos por conta
  const txtData = concatUint8Arrays([key, val]);
  out.splice(out.length - 1, 0, makePngChunk("tEXt", txtData));
  removed.push(`injeção tEXt único (${randomHex(4, seed)})`);

  // tIME com timestamp único por conta
  const ts = randomTimestamp(seed ^ 0xF00D);
  const d  = new Date(ts * 1000);
  const timeData = new Uint8Array(7);
  const yr = d.getUTCFullYear();
  timeData[0] = (yr >> 8) & 0xFF;
  timeData[1] = yr & 0xFF;
  timeData[2] = d.getUTCMonth() + 1;
  timeData[3] = d.getUTCDate();
  timeData[4] = d.getUTCHours();
  timeData[5] = d.getUTCMinutes();
  timeData[6] = d.getUTCSeconds();
  out.splice(out.length - 1, 0, makePngChunk("tIME", timeData));
  removed.push("tIME com timestamp variável por conta");

  return { buf: concatUint8Arrays(out), removed };
}

// ─── WebP ─────────────────────────────────────────────────────────────────────
// Remove: EXIF, XMP_
// Injeta por conta: chunk UNKN com dados únicos

const WEBP_DROP_CHUNKS = new Set(["EXIF", "XMP "]);

function sanitizeWebp(buf, seed) {
  const removed = [];
  const riff = readAscii(buf, 0, 4);
  const webp = readAscii(buf, 8, 4);
  if (riff !== "RIFF" || webp !== "WEBP") return { buf, removed: ["não é WebP válido"] };

  const out = [buf.slice(0, 12)];
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

  // Chunk UNKN com 20 bytes únicos por conta
  const rnd  = randomBytes(20, seed);
  const unkn = new Uint8Array(8 + 20);
  unkn.set(asciiBytes("UNKN"), 0);
  unkn[4] = 20; unkn[5] = 0; unkn[6] = 0; unkn[7] = 0;
  unkn.set(rnd, 8);
  out.push(unkn);
  removed.push(`injeção UNKN único (${randomHex(4, seed)})`);

  const result = concatUint8Arrays(out);
  const totalSize = result.length - 8;
  result[4] =  totalSize        & 0xFF;
  result[5] = (totalSize >> 8)  & 0xFF;
  result[6] = (totalSize >> 16) & 0xFF;
  result[7] = (totalSize >> 24) & 0xFF;

  return { buf: result, removed };
}

// ─── MP4 / MOV ────────────────────────────────────────────────────────────────
// Apenas variações seguras: timestamps no mvhd + atom uuid único por conta
// NÃO remove atoms do moov — corrompe o bitstream

const MP4_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "ilst"]);

function varyMp4(buf, seed) {
  const removed = [];
  const work    = new Uint8Array(buf);

  // Variar timestamps no mvhd (creation_time e modification_time são u32 em offset 8 e 12)
  let i = 0;
  while (i < work.length - 8) {
    if (readAscii(work, i + 4, 4) === "mvhd" && i + 20 < work.length) {
      const ts = randomTimestamp(seed ^ 0xA5A5);
      writeU32BE(work, i + 8,  ts);           // creation_time
      writeU32BE(work, i + 12, ts + (readU32BE(randomBytes(4, seed), 0) % 3600));
      removed.push(`mvhd timestamps variados (${ts})`);
      break;
    }
    const size = readU32BE(work, i);
    if (size < 8) break;
    i += size;
  }

  // Injetar atom "free" com 20 bytes únicos por conta logo após o ftyp
  // "free" é ignorado por todos os players — seguro
  let insertAt = 0;
  i = 0;
  while (i < work.length - 8) {
    const size = readU32BE(work, i);
    const type = readAscii(work, i + 4, 4);
    if (size < 8) break;
    if (type === "ftyp") { insertAt = i + size; break; }
    i += size;
  }

  const freeData = randomBytes(20, seed ^ 0x1234);
  const freeAtom = new Uint8Array(8 + 20);
  writeU32BE(freeAtom, 0, 28);
  freeAtom.set(asciiBytes("free"), 4);
  freeAtom.set(freeData, 8);
  removed.push(`injeção atom free único (${randomHex(4, seed)})`);

  // Inserir após ftyp
  const before = work.slice(0, insertAt);
  const after  = work.slice(insertAt);
  return {
    buf: concatUint8Arrays([before, freeAtom, after]),
    removed,
  };
}

// ─── Detector de formato ──────────────────────────────────────────────────────

function detectFormat(buf, mimeType) {
  if (buf[0] === 0xFF && buf[1] === 0xD8) return "jpeg";
  if (buf[0] === 137  && buf[1] === 80)  return "png";
  if (readAscii(buf, 0, 4) === "RIFF" && readAscii(buf, 8, 4) === "WEBP") return "webp";
  if (buf.length > 12) {
    const ftyp = readAscii(buf, 4, 4);
    if (ftyp === "ftyp" || ftyp === "moov" || ftyp === "mdat") return "mp4";
  }
  if (mimeType?.includes("jpeg"))      return "jpeg";
  if (mimeType?.includes("png"))       return "png";
  if (mimeType?.includes("webp"))      return "webp";
  if (mimeType?.includes("mp4"))       return "mp4";
  if (mimeType?.includes("quicktime")) return "mp4";
  if (mimeType?.includes("video"))     return "mp4";
  return "unknown";
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Sanitiza um File no browser.
 * @param {File} file — arquivo original
 * @param {string} [accountId] — ID da conta (gera fingerprint único por conta)
 * @returns {Promise<{ file: File, report: object }>}
 */
export async function sanitizeFile(file, accountId) {
  const startMs  = performance.now();
  const arrayBuf = await file.arrayBuffer();
  const original = new Uint8Array(arrayBuf);

  // Seed única por arquivo+conta — garante que o mesmo arquivo tenha fingerprints
  // diferentes quando enviado para contas diferentes
  const fileSeed    = accountSeed(file.name + file.size);
  const accSeed     = accountSeed(accountId || "");
  const combinedSeed = (fileSeed ^ accSeed ^ Date.now()) >>> 0;

  const uniqueId = randomHex(8, combinedSeed);
  const format   = detectFormat(original, file.type);

  let result = { buf: original, removed: [] };

  if      (format === "jpeg") result = sanitizeJpeg(original, combinedSeed, true);
  else if (format === "png")  result = sanitizePng(original, combinedSeed);
  else if (format === "webp") result = sanitizeWebp(original, combinedSeed);
  else if (format === "mp4")  result = varyMp4(original, combinedSeed);
  // outros formatos: retorna sem modificação

  const durationMs = Math.round(performance.now() - startMs);
  const sizeDiff   = result.buf.length - original.length;

  // Nome único por conta+arquivo
  const ext      = file.name.split(".").pop();
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const newName  = `${baseName}_s${uniqueId}.${ext}`;

  const sanitized = new File(
    [result.buf],
    newName,
    { type: file.type, lastModified: Date.now() - (combinedSeed % 86_400_000) }
    // lastModified também varia por conta — mais um fingerprint diferente
  );

  const report = {
    originalName:  file.name,
    sanitizedName: newName,
    format,
    uniqueId,
    accountId:     accountId || null,
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
 * Sanitiza o mesmo arquivo para múltiplas contas.
 * Cada conta recebe uma variação diferente do arquivo.
 *
 * @param {File} file
 * @param {string[]} accountIds
 * @returns {Promise<Array<{ accountId, file, report }>>}
 */
export async function sanitizeFileForAccounts(file, accountIds) {
  return Promise.all(
    accountIds.map(async (accountId) => {
      const { file: sanitized, report } = await sanitizeFile(file, accountId);
      return { accountId, file: sanitized, report };
    })
  );
}

/**
 * Retorna um resumo legível do relatório de sanitização
 */
export function formatReport(report) {
  if (!report) return "—";
  const lines = [
    `Formato: ${report.format.toUpperCase()}`,
    `ID único: ${report.uniqueId}`,
    report.accountId ? `Conta: ${report.accountId}` : null,
    `Tamanho: ${(report.originalSize / 1024).toFixed(0)} KB → ${(report.sanitizedSize / 1024).toFixed(0)} KB (${report.sizeDiff >= 0 ? "+" : ""}${report.sizeDiff}B)`,
    `Removido/injetado: ${report.removed.join(", ") || "nenhum"}`,
    `Tempo: ${report.durationMs}ms`,
  ].filter(Boolean);
  return lines.join("\n");
}
