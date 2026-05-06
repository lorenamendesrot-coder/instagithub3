// useToast.js — Hook isolado para gerenciamento de toasts
import { useState, useCallback } from "react";

export function useToast(duration = 4500) {
  const [toast, setToast] = useState(null);

  const showToast = useCallback((type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), duration);
  }, [duration]);

  const hideToast = useCallback(() => setToast(null), []);

  return { toast, showToast, hideToast };
}
