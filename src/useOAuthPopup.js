// useOAuthPopup.js
// Abre o OAuth do Meta em um popup flutuante.
// Quando o Instagram redireciona de volta, o popup fecha sozinho
// e o App.jsx já recebe as contas via postMessage — sem recarregar a página.

import { useCallback, useEffect, useRef, useState } from "react";

const SCOPE = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "pages_read_engagement",
  "pages_show_list",
  "pages_manage_posts",
  "business_management",
  "pages_manage_metadata",
].join(",");

export function useOAuthPopup({ onAccounts, onError }) {
  const [status,   setStatus]   = useState("idle"); // idle | opening | waiting | saving | done | error
  const [errorMsg, setErrorMsg] = useState(null);
  const popupRef  = useRef(null);
  const timerRef  = useRef(null);

  // Escuta mensagens do popup filho
  useEffect(() => {
    const handler = (event) => {
      // Só aceita mensagens da mesma origem
      if (event.origin !== window.location.origin) return;

      const { type, accounts, error } = event.data || {};

      if (type === "OAUTH_ACCOUNTS" && accounts) {
        closePopup();
        setStatus("saving");
        onAccounts(accounts);
      }

      if (type === "OAUTH_ERROR") {
        closePopup();
        setStatus("error");
        setErrorMsg(error || "Erro no login. Tente novamente.");
        onError?.(error);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onAccounts, onError]);

  const closePopup = useCallback(() => {
    if (timerRef.current)  clearInterval(timerRef.current);
    if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
    popupRef.current = null;
  }, []);

  const openPopup = useCallback(() => {
    const APP_ID   = import.meta.env.VITE_META_APP_ID;
    const redirect = window.location.origin + "/api/auth-callback";
    const url      = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(redirect)}&scope=${SCOPE}&response_type=code&state=popup`;

    // Dimensões e posição centrada
    const w = 520, h = 680;
    const left = Math.round(window.screenX + (window.outerWidth  - w) / 2);
    const top  = Math.round(window.screenY + (window.outerHeight - h) / 2);

    const popup = window.open(
      url,
      "instagram_oauth",
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
    );

    if (!popup) {
      setStatus("error");
      setErrorMsg("Popup bloqueado pelo navegador. Permita popups para este site e tente novamente.");
      onError?.("popup_blocked");
      return;
    }

    popupRef.current = popup;
    setStatus("waiting");
    setErrorMsg(null);

    // Verifica a cada 500ms se o popup fechou sem completar
    timerRef.current = setInterval(() => {
      if (popup.closed) {
        clearInterval(timerRef.current);
        // Se ainda está em "waiting", o usuário fechou manualmente
        setStatus((prev) => {
          if (prev === "waiting") {
            setErrorMsg("Login cancelado.");
            return "error";
          }
          return prev;
        });
        popupRef.current = null;
      }
    }, 500);
  }, [onAccounts, onError]);

  const reset = useCallback(() => {
    closePopup();
    setStatus("idle");
    setErrorMsg(null);
  }, [closePopup]);

  return { status, errorMsg, openPopup, reset };
}
