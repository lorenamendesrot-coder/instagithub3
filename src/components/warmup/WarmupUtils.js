// WarmupUtils.js — utilitários e funções de cálculo do aquecimento
import { sanitizeFile } from "../../sanitizeClient.js";

export const JITTER_MIN_RANGE = [-40, 40];
export const JITTER_SEC_RANGE = [0, 59];
export const NEW_ACCOUNT_DAYS = 2;
export const WARMUP_PRESET_2D = {
  id:    "fast2d",
  label: "Aquecimento Rápido 2 Dias 🚀",
  desc:  "Foco em Reels com Feed e Stories complementares. Alta proteção de conta.",
  days: [
    {
      day: 1,
      label: "Dia 1 — Arranque Suave",
      reels:   10,
      feed:    0,
      stories: 0,
      windowStart: "09:00",
      windowEnd:   "21:30",
      intervalMinMin: 60,
      intervalMinMax: 75,
      jitterMin: 8,
    },
    {
      day: 2,
      label: "Dia 2 — Aceleração",
      reels:   20,
      feed:    0,
      stories: 0,
      windowStart: "09:00",
      windowEnd:   "21:30",
      intervalMinMin: 60,
      intervalMinMax: 75,
      jitterMin: 8,
    },
    {
      day: 3,
      label: "Dia 3 — Manutenção de Nível",
      reels:   30,
      feed:    0,
      stories: 0,
      windowStart: "09:00",
      windowEnd:   "21:30",
      intervalMinMin: 60,
      intervalMinMax: 75,
      jitterMin: 8,
    },
  ],
};

export const TABS = [
  { id: "upload",   icon: "📤", label: "Upload"          },
  { id: "captions", icon: "💬", label: "Legendas"        },
  { id: "config",   icon: "⚙️",  label: "Configuração"   },
  { id: "preview",  icon: "📅", label: "Preview da Fila" },
  { id: "monitor",  icon: "📊", label: "Monitor"         },
];

export const MEDIA_TYPES = [
  { id: "reels",   icon: "🎬", label: "Reels",   accept: "video/*",         hint: "MP4, MOV · 8–90s recomendado",         postType: "REEL",  mediaType: "VIDEO" },
  { id: "feed",    icon: "🖼",  label: "Feed",    accept: "image/*,video/*", hint: "JPG, PNG, MP4 · fotos e carrosséis",   postType: "FEED",  mediaType: "IMAGE" },
  { id: "stories", icon: "⭕",  label: "Stories", accept: "image/*,video/*", hint: "Vertical 9:16 · até 15s para vídeo",  postType: "STORY", mediaType: "IMAGE" },
];


// ─── Utilitários ──────────────────────────────────────────────────────────────

export function fmtSize(b) {
  if (!b) return "—";
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

export function warmupDay(connectedAt) {
  const diff = Math.floor((Date.now() - new Date(connectedAt)) / 86400000);
  return Math.min(diff + 1, 99);
}

export function isNewAccount(acc) {
  return warmupDay(acc.connected_at || new Date().toISOString()) <= NEW_ACCOUNT_DAYS;
}

// Upload direto do browser para R2 via presigned URL — sem limite de tamanho
// Detecta o MIME type correto pelo nome/extensão do arquivo
function detectMime(file) {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.split(".").pop().toLowerCase();
  const MAP = {
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    avi: "video/x-msvideo", mkv: "video/x-matroska",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    webp: "image/webp", gif: "image/gif", heic: "image/heic",
  };
  return MAP[ext] || "video/mp4";
}

export async function uploadFile(file, onProgress, onSanitized) {
  onProgress(2);

  // Detectar MIME correto — file.type pode estar vazio em drag-and-drop
  const mimeType = detectMime(file);

  // Passo 1: obter presigned URL
  const presignRes = await fetch("/api/r2-presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType }),
  });
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}));
    throw new Error(err.error || `Erro ao gerar URL (${presignRes.status})`);
  }
  const { presignedUrl, publicUrl } = await presignRes.json();
  onProgress(8);

  // Passo 2: sanitizar no browser (remove EXIF/metadados)
  let fileToUpload = file;
  try {
    const { file: sanitized, report } = await sanitizeFile(file);
    // Garantir que o arquivo sanitizado tem o MIME correto
    // (File criado com type: "" perde o tipo — recriar com tipo explícito)
    fileToUpload = sanitized.type
      ? sanitized
      : new File([sanitized], sanitized.name, { type: mimeType, lastModified: sanitized.lastModified });
    if (onSanitized) onSanitized(report);
    onProgress(18);
  } catch (err) {
    console.warn("Sanitização falhou, usando arquivo original:", err.message);
    if (onSanitized) onSanitized({ error: err.message, supported: false });
    // Mesmo no fallback, garantir MIME correto
    fileToUpload = new File([file], file.name, { type: mimeType, lastModified: file.lastModified });
  }

  // Passo 3: PUT direto no R2 com progresso real via XHR
  // Content-Type DEVE bater exatamente com o que foi assinado no presign
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 80) + 18);
    };
    xhr.onload    = () => {
      if (xhr.status === 200) resolve();
      else reject(new Error(`R2 HTTP ${xhr.status} — verifique CORS do bucket`));
    };
    xhr.onerror   = () => reject(new Error("Erro de rede durante o upload"));
    xhr.ontimeout = () => reject(new Error("Timeout no upload — arquivo muito grande?"));
    xhr.timeout   = 10 * 60 * 1000; // 10 min para arquivos grandes
    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", mimeType); // usa mimeType detectado, não file.type
    xhr.send(fileToUpload);
  });

  onProgress(100);
  return publicUrl;
}

export function addJitter(date, minRange, secRange) {
  const jitterMin = Math.floor(Math.random() * (minRange[1] - minRange[0] + 1)) + minRange[0];
  const jitterSec = Math.floor(Math.random() * (secRange[1] - secRange[0] + 1)) + secRange[0];
  const result = new Date(date.getTime());
  result.setMinutes(result.getMinutes() + jitterMin);
  result.setSeconds(jitterSec);
  return result;
}

export function timeToMs(dateBase, timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(dateBase);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// ─── Gera slots por meta (quantidade em período) ──────────────────────────────
// Ex: 10 reels em 1h → calcula intervalo ideal com jitter para caber tudo
export function generateSlotsByTarget({ dayBase, count, periodHours, windowStart: ws, windowEnd: we }) {
  const windowStart = timeToMs(dayBase, ws);
  const windowEnd   = timeToMs(dayBase, we);
  const windowMs    = windowEnd - windowStart;

  // Período alvo em ms — não pode ultrapassar a janela disponível
  const periodMs    = Math.min(periodHours * 3600000, windowMs);

  if (count <= 0 || periodMs <= 0) return [];

  // Intervalo base = período / (count - 1) ou período / count se só 1
  const baseInterval = count > 1 ? periodMs / (count - 1) : periodMs;

  // Jitter de ±20% do intervalo (mínimo 10s, máximo 5min)
  const jitterAmp = Math.min(300000, Math.max(10000, baseInterval * 0.2));

  const times = [];
  for (let i = 0; i < count; i++) {
    const base    = windowStart + i * baseInterval;
    const jitter  = (Math.random() * 2 - 1) * jitterAmp;
    const seconds = Math.floor(Math.random() * 59);
    const t       = new Date(Math.min(Math.max(base + jitter, windowStart), windowEnd));
    t.setSeconds(seconds);
    times.push(t);
  }
  return times;
}

export function generateSlotTimes(dayBase, count, plan) {
  const windowStart = timeToMs(dayBase, plan.windowStart);
  const windowEnd   = timeToMs(dayBase, plan.windowEnd);

  // Intervalo base aleatório entre min e max (distribui os posts na janela)
  const intervalMin = plan.intervalMinMin * 60 * 1000;
  const intervalMax = (plan.intervalMinMax || plan.intervalMinMin) * 60 * 1000;

  // Jitter em minutos específico do preset (±N min) + segundos aleatórios
  const jM = plan.jitterMin ?? 10; // fallback 10min se não definido
  const jitterMinRange = [-jM, jM];

  const times = [];
  let cursor = windowStart;

  for (let i = 0; i < count; i++) {
    // Intervalo aleatório entre min e max para cada slot
    const randInterval = intervalMin + Math.random() * (intervalMax - intervalMin);
    const base = i === 0 ? new Date(cursor) : new Date(cursor + randInterval);
    cursor = base.getTime();

    if (cursor > windowEnd) break;

    // Aplica jitter de minutos e segundos aleatórios
    const jittered = addJitter(base, jitterMinRange, JITTER_SEC_RANGE);
    const final = new Date(Math.min(Math.max(jittered.getTime(), windowStart), windowEnd));
    times.push(final);
    cursor = final.getTime(); // avança o cursor para o slot atual
  }
  return times;
}

export function buildWarmupQueue({ accounts, mediaByType, captions, captionMode, preset, startDateStr, distribution, loopEnabled, loopDays }) {
  const slots = [];
  if (!accounts.length) return slots;

  const startBase = new Date(startDateStr + "T00:00:00");

  // Dias base do preset + dias extras em loop (repetindo o Dia 3 de manutenção)
  const baseDays = preset.days;
  const allDays  = [...baseDays];

  if (loopEnabled && loopDays > 0) {
    const maintenanceDay = baseDays[baseDays.length - 1]; // Dia 3
    for (let extra = 1; extra <= loopDays; extra++) {
      allDays.push({
        ...maintenanceDay,
        day:   baseDays.length + extra,
        label: `Dia ${baseDays.length + extra} — Manutenção (Loop ${extra})`,
      });
    }
  }

  allDays.forEach((dayPlan) => {
    const dayBase = new Date(startBase);
    dayBase.setDate(dayBase.getDate() + (dayPlan.day - 1));

    const typeConfig = [
      { key: "reels",   count: dayPlan.reels,   ...MEDIA_TYPES[0] },
      { key: "feed",    count: dayPlan.feed,     ...MEDIA_TYPES[1] },
      { key: "stories", count: dayPlan.stories,  ...MEDIA_TYPES[2] },
    ];

    const daySlots = [];

    typeConfig.forEach(({ key, count, postType, mediaType }) => {
      const pool = mediaByType[key] || [];
      if (!pool.length || !count) return;

      accounts.forEach((acc, accIdx) => {
        // Modo target: quantidade em período definido
        const times = dayPlan.targetMode && dayPlan.targetCount && dayPlan.targetPeriodHours
          ? generateSlotsByTarget({
              dayBase,
              count:       dayPlan.targetCount,
              periodHours: dayPlan.targetPeriodHours,
              windowStart: dayPlan.windowStart,
              windowEnd:   dayPlan.windowEnd,
            })
          : generateSlotTimes(dayBase, count, dayPlan);
        times.forEach((scheduledDate, k) => {
          const mediaIdx = distribution === "random"
            ? Math.floor(Math.random() * pool.length)
            : (accIdx * count + k) % pool.length;
          const media     = pool[mediaIdx];
          const slotIdx   = slots.length + daySlots.length;
          const caption   = captions.length ? pickCaption(captions, captionMode, slotIdx) : "";

          daySlots.push({
            id:            `wup-${acc.id}-${dayPlan.day}-${key}-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            accountId:     acc.id,
            username:      acc.username,
            mediaUrl:      media.url,
            mediaUrls:     [media.url],
            mediaName:     media.name,
            mediaType,
            postType,
            mediaCategory: key,
            caption,
            bulkCaptions:  captions,
            captionMode,
            accounts:      [{ id: acc.id, username: acc.username, access_token: acc.access_token, page_id: acc.page_id || null }],
            scheduledAt:   scheduledDate.getTime(),
            scheduledDay:  dayPlan.day,
            status:        "pending",
            warmup:        true,
            warmupDay:     dayPlan.day,
            created_at:    new Date().toISOString(),
          });
        });
      });
    });

    daySlots.sort((a, b) => a.scheduledAt - b.scheduledAt);
    slots.push(...daySlots);
  });

  return slots;
}

export function shadowScore(insights) {
  if (!insights || insights.length < 3) return null;
  const vs  = insights.map((i) => i.views || i.reach || 0);
  const avg  = vs.reduce((a, b) => a + b, 0) / vs.length;
  const last = vs[vs.length - 1];
  const drop = avg > 0 ? Math.round(((avg - last) / avg) * 100) : 0;
  return { avg: Math.round(avg), last, drop };
}

