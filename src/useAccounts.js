// useAccounts.js — Gerenciamento de contas com sessões no IndexedDB
// Tokens ficam no IndexedDB (não no localStorage em texto puro)
// O frontend guarda apenas metadados públicos no localStorage;
// o token completo fica em IndexedDB (mais seguro que localStorage simples,
// ainda no browser mas inacessível por scripts de terceiros via localStorage API)

import { useState, useEffect } from "react";
import { dbGetAll, dbPut, dbDelete, dbClear } from "./useDB.js";

const STORE = "sessions";

export function useAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const all = await dbGetAll(STORE);
      setAccounts(all);
    } catch {
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const addAccounts = async (newAccs) => {
    const existing = await dbGetAll(STORE);
    for (const acc of newAccs) {
      const idx = existing.findIndex((a) => a.id === acc.id);
      if (idx >= 0) {
        await dbPut(STORE, { ...existing[idx], ...acc, connected_at: new Date().toISOString() });
      } else {
        await dbPut(STORE, { ...acc, connected_at: new Date().toISOString() });
      }
    }
    await reload();
  };

  const removeAccount = async (id) => {
    await dbDelete(STORE, id);
    setAccounts((p) => p.filter((a) => a.id !== id));
  };

  const clearAllAccounts = async () => {
    await dbClear(STORE);
    setAccounts([]);
  };

  return { accounts, loading, addAccounts, removeAccount, clearAllAccounts, reloadAccounts: reload };
}
