// useTokenCheck.js — Verifica validade dos tokens e alerta o usuário proativamente
import { useEffect, useRef, useCallback } from "react";
import { dbGetAll, dbPut } from "./useDB.js";

const GRAPH_FB = "https://graph.facebook.com/v21.0";
const GRAPH_IG = "https://graph.instagram.com/v21.0";

// Tokens do Instagram Login começam com "IGAA"
// Tokens do Facebook Login começam com "EAA"
function isIGToken(token) {
  return token?.startsWith("IGAA");
}

// Verifica tokens a cada 6 horas
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function checkToken(account) {
  try {
    const token = account.access_token;
    const base  = isIGToken(token) ? GRAPH_IG : GRAPH_FB;
    const res   = await fetch(`${base}/me?fields=id&access_token=${token}`);
    const data  = await res.json();
    if (data.error?.code === 190) return "expired";
    if (data.error) return "invalid";
    return "valid";
  } catch {
    return "unknown"; // falha de rede — não marcar como expirado
  }
}

/**
 * Hook que verifica os tokens de todas as contas conectadas periodicamente.
 * Chama onExpired(accounts) com a lista de contas com token expirado.
 */
export function useTokenCheck({ accounts, onExpired }) {
  const timerRef = useRef(null);

  const runCheck = useCallback(async () => {
    if (!accounts.length) return;
    const expired = [];

    for (const acc of accounts) {
      const status = await checkToken(acc);
      if (status === "expired" || status === "invalid") {
        await dbPut("sessions", { ...acc, token_status: "expired" });
        expired.push({ ...acc, token_status: "expired" });
      } else if (status === "valid") {
        if (acc.token_status === "expired") {
          await dbPut("sessions", { ...acc, token_status: "valid" });
        }
      }
    }

    if (expired.length > 0) {
      onExpired(expired);
    }
  }, [accounts, onExpired]);

  useEffect(() => {
    const initial = setTimeout(runCheck, 5000);
    timerRef.current = setInterval(runCheck, CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timerRef.current);
    };
  }, [runCheck]);

  return { runCheck };
}
