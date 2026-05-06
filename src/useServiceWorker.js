// useServiceWorker.js — Hook isolado para registro e comunicação com o Service Worker
import { useState, useEffect } from "react";

export function useServiceWorker() {
  const [swStatus, setSwStatus] = useState("loading");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      setSwStatus("unsupported");
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        setSwStatus("active");
        reg.update();
        navigator.serviceWorker.addEventListener("message", (e) => {
          if (e.data?.type === "QUEUE_UPDATE") {
            window.dispatchEvent(new CustomEvent("sw:queue-update"));
          }
        });
      })
      .catch(() => setSwStatus("error"));
  }, []);

  return { swStatus };
}
