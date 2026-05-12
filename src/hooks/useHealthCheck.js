// useHealthCheck.js — Hook de Health Check diário com pausa automática
import { useState, useEffect, useCallback, useRef } from "react";
import { dbGet, dbPut } from "../useDB.js";

const DB_KEY         = "health_check_latest";
const STORE          = "protection";
const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const MIN_INTERVAL   = 60 * 60 * 1000;

export function useHealthCheck(accounts, { onAutoPause, onToast } = {}) {
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const runningRef = useRef(false);

  // Carrega último resultado salvo
  useEffect(() => {
    dbGet(STORE, DB_KEY).then((row) => {
      if (row?.data) { setResult(row.data); setLastRun(new Date(row.data.checked_at)); }
    }).catch(() => {});
  }, []);

  const runCheck = useCallback(async (force = false) => {
    if (runningRef.current || !accounts?.length) return;
    if (!force && lastRun && Date.now() - lastRun.getTime() < MIN_INTERVAL) return;
    runningRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/.netlify/functions/health-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResult(data);
      setLastRun(new Date(data.checked_at));
      await dbPut(STORE, { id: DB_KEY, data, updatedAt: new Date().toISOString() });

      const autoPaused = data.results?.filter((r) => r.auto_paused) || [];
      if (autoPaused.length > 0) {
        for (const r of autoPaused) onAutoPause?.(r.id, r.pause_reason);
        onToast?.(`⏸️ ${autoPaused.length} conta(s) pausada(s) por queda de reach`, "warning");
      }
      const expired = data.results?.filter((r) => r.status === "token_expired") || [];
      if (expired.length > 0)
        onToast?.(`⚠️ ${expired.length} token(s) expirado(s) — reconecte as contas`, "danger");
      return data;
    } catch (err) {
      console.error("[useHealthCheck]", err.message);
      onToast?.(`Erro no Health Check: ${err.message}`, "danger");
    } finally {
      setLoading(false);
      runningRef.current = false;
    }
  }, [accounts, lastRun, onAutoPause, onToast]);

  // Dispara 1x por dia automaticamente
  useEffect(() => {
    if (!accounts?.length) return;
    const shouldRun = !lastRun || Date.now() - lastRun.getTime() >= CHECK_INTERVAL;
    if (shouldRun) runCheck();
    const iv = setInterval(() => runCheck(), CHECK_INTERVAL);
    return () => clearInterval(iv);
  }, [accounts?.length]);

  const stats = result ? {
    total:   result.total        || 0,
    paused:  result.paused_count || 0,
    warned:  result.warn_count   || 0,
    expired: result.expired_count || 0,
    ok: Math.max(0, (result.total || 0) - (result.paused_count || 0) - (result.warn_count || 0) - (result.expired_count || 0)),
  } : null;

  const getAccountResult = (igId) => result?.results?.find((r) => r.id === igId) || null;

  return { result, loading, lastRun, stats, runCheck, getAccountResult };
}
