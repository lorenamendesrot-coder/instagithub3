// useAccounts.js — Contas salvas no Netlify Blobs (persistência em nuvem)
// Funciona em qualquer PC/navegador — não depende mais do IndexedDB local
// Fallback: se a API falhar, usa cache local temporário (sessionStorage)

import { useState, useEffect, useCallback } from "react";

const API = "/.netlify/functions/accounts";

// Cache em memória para evitar re-fetches desnecessários na mesma sessão
let _memCache = null;

export function useAccounts() {
  const [accounts, setAccounts] = useState(_memCache || []);
  const [loading, setLoading]   = useState(!_memCache);
  const [syncing, setSyncing]   = useState(false);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const res  = await fetch(API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const accs = data.accounts || [];
      _memCache = accs;
      setAccounts(accs);
    } catch (err) {
      console.error("useAccounts: erro ao carregar contas:", err);
      // Mantém o estado atual se já tiver algo
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!_memCache) reload();
  }, []);

  // Salva uma ou mais contas na nuvem
  const addAccounts = useCallback(async (newAccs) => {
    setSyncing(true);
    try {
      // Merge local imediato (UX rápida)
      const merged = [...(accounts)];
      for (const acc of newAccs) {
        const idx = merged.findIndex((a) => a.id === acc.id);
        const entry = { ...acc, connected_at: acc.connected_at || new Date().toISOString() };
        if (idx >= 0) merged[idx] = { ...merged[idx], ...entry };
        else merged.push(entry);
      }
      _memCache = merged;
      setAccounts(merged);

      // Persiste na nuvem
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: newAccs.map((acc) => ({
          ...acc,
          connected_at: acc.connected_at || new Date().toISOString(),
        })) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Recarrega para garantir consistência
      await reload();
    } catch (err) {
      console.error("useAccounts: erro ao salvar conta:", err);
    } finally {
      setSyncing(false);
    }
  }, [accounts, reload]);

  // Remove conta da nuvem
  const removeAccount = useCallback(async (id) => {
    // Remove local imediatamente
    const updated = accounts.filter((a) => a.id !== id);
    _memCache = updated;
    setAccounts(updated);

    try {
      const res = await fetch(`${API}?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error("useAccounts: erro ao remover conta:", err);
      // Se falhar na nuvem, recarrega para sincronizar
      await reload();
    }
  }, [accounts, reload]);

  // Remove todas as contas
  const clearAllAccounts = useCallback(async () => {
    const toDelete = [...accounts];
    _memCache = [];
    setAccounts([]);
    try {
      await Promise.all(toDelete.map((a) =>
        fetch(`${API}?id=${a.id}`, { method: "DELETE" })
      ));
    } catch (err) {
      console.error("useAccounts: erro ao limpar contas:", err);
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
