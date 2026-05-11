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
      reels:   3,
      feed:    1,
      stories: 2,
      windowStart: "09:00",
      windowEnd:   "21:30",
      intervalMinMin: 90,
      intervalMinMax: 150,
    },
    {
      day: 2,
      label: "Dia 2 — Aceleração",
      reels:   5,
      feed:    2,
      stories: 3,
      windowStart: "09:00",
      windowEnd:   "21:30",
      intervalMinMin: 60,
      intervalMinMax: 120,
    },
    {
      day: 3,
      label: "Dia 3 — Manutenção de Nível",
      reels:   4,
      feed:    2,
      stories: 3,
      windowStart: "09:00",
      windowEnd:   "21:30",
      intervalMinMin: 70,
      intervalMinMax: 130,
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

// Upload via FilGarden (alternativa ao R2)
export async function uploadFileGarden(file, onProgress) {
  onProgress(5);
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
    reader.readAsDataURL(file);
  });
  onProgress(30);
  const res = await fetch("/api/filegarden-proxy", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64: base64, fileName: file.name, mimeType: file.type || "video/mp4" }),
  });
  onProgress(90);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `FilGarden HTTP ${res.status}`);
  }
  const { url } = await res.json();
  if (!url) throw new Error("FilGarden não retornou URL");
  onProgress(100);
  return url;
}

// Upload direto do browser para R2 via presigned URL — sem limite de tamanho
export async function uploadFile(file, onProgress, onSanitized) {

  // Passo 1: obter presigned URL
  const presignRes = await fetch("/api/r2-presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type || "video/mp4" }),
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
    fileToUpload = sanitized;
    if (onSanitized) onSanitized(report);
    onProgress(18);
  } catch (err) {
    console.warn("Sanitização falhou, usando arquivo original:", err.message);
    if (onSanitized) onSanitized({ error: err.message, supported: false });
  }

  // Passo 3: PUT direto no R2 com progresso real via XHR
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 80) + 18);
    };
    xhr.onload    = () => xhr.status === 200 ? resolve() : reject(new Error(`R2 HTTP ${xhr.status}`));
    xhr.onerror   = () => reject(new Error("Erro de rede durante o upload"));
    xhr.ontimeout = () => reject(new Error("Timeout no upload"));
    xhr.timeout   = 5 * 60 * 1000;
    xhr.open("PUT", presignedUrl);
    xhr.setRequestHeader("Content-Type", fileToUpload.type || "video/mp4");
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

export function generateSlotTimes(dayBase, count, plan) {
  let windowStart = timeToMs(dayBase, plan.windowStart);
  let windowEnd   = timeToMs(dayBase, plan.windowEnd);
  const now = Date.now();

  // Se a janela inteira já passou, estende o windowEnd para now + espaço suficiente
  // Isso permite gerar slots mesmo fora do horário (útil para testes)
  if (windowEnd < now) {
    windowStart = now + 60000;
    windowEnd   = now + (count * 10 * 60 * 1000) + 60000; // count × 10min + margem
  } else if (windowStart < now) {
    // Janela já começou — parte do momento atual
    windowStart = now + 60000;
  }

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
        const times = generateSlotTimes(dayBase, count, dayPlan);
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
            accounts:      [{ id: acc.id, username: acc.username }],
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

