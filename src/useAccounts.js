// useAccounts.js — Contas salvas no Netlify Blobs (persistência em nuvem)
// Funciona em qualquer PC/navegador — não depende mais do IndexedDB local

import { useState, useEffect, useCallback } from "react";

const API = "/.netlify/functions/accounts";

let _memCache = null;

export function useAccounts() {
  const [accounts, setAccounts] = useState(_memCache || []);
  const [loading, setLoading]   = useState(!_memCache);
  const [syncing, setSyncing]   = useState(false);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(API);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data = await res.json();
      const accs = data.accounts || [];
      _memCache = accs;
      setAccounts(accs);
    } catch (err) {
      console.error("[useAccounts] Erro ao carregar contas:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!_memCache) reload();
  }, []);

  const addAccounts = useCallback(async (newAccs) => {
    setSyncing(true);
    try {
      // Atualiza local imediatamente para UX rápida
      const current = _memCache || [];
      const merged  = [...current];
      for (const acc of newAccs) {
        const idx = merged.findIndex((a) => a.id === acc.id);
        const entry = { ...acc, connected_at: acc.connected_at || new Date().toISOString() };
        if (idx >= 0) merged[idx] = { ...merged[idx], ...entry };
        else merged.push(entry);
      }
      _memCache = merged;
      setAccounts(merged);

      // Salva na nuvem — lança erro se falhar
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accounts: newAccs.map((acc) => ({
            ...acc,
            connected_at: acc.connected_at || new Date().toISOString(),
          })),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Erro ao salvar na nuvem: HTTP ${res.status} — ${text}`);
      }

      // Recarrega para confirmar o que foi salvo
      await reload();
    } catch (err) {
      console.error("[useAccounts] Erro ao salvar conta:", err);
      throw err; // propaga para o App.jsx mostrar o toast de erro
    } finally {
      setSyncing(false);
    }
  }, [reload]);

  const removeAccount = useCallback(async (id) => {
    const updated = (_memCache || accounts).filter((a) => a.id !== id);
    _memCache = updated;
    setAccounts(updated);
    try {
      const res = await fetch(`${API}?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("[useAccounts] Erro ao remover conta:", err);
      await reload();
    }
  }, [accounts, reload]);

  const clearAllAccounts = useCallback(async () => {
    const toDelete = [...(_memCache || accounts)];
    _memCache = [];
    setAccounts([]);
    try {
      await Promise.all(toDelete.map((a) =>
        fetch(`${API}?id=${a.id}`, { method: "DELETE" })
      ));
    } catch (err) {
      console.error("[useAccounts] Erro ao limpar contas:", err);
    }
  }, [accounts]);

  return {
    accounts,
    loading,
    syncing,
    addAccounts,
    removeAccount,
    clearAllAccounts,
    reloadAccounts: reload,
  };
}
