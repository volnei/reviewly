import Database from "@tauri-apps/plugin-sql";
import type { PersistStorage, StorageValue } from "zustand/middleware";

let dbPromise: Promise<Database> | null = null;
function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load("sqlite:reviewly.db");
  return dbPromise;
}

interface Row {
  v: string;
}

/**
 * Zustand persistence backend backed by the local SQLite `kv` table.
 *
 * Drop-in replacement for `createJSONStorage(() => localStorage)`. On the
 * first read we also migrate any matching localStorage entry over so the
 * user doesn't lose state from an earlier dev build that used the browser.
 */
export function sqlStorage<T>(): PersistStorage<T> {
  return {
    async getItem(name) {
      try {
        const db = await getDb();
        const rows = await db.select<Row[]>("SELECT v FROM kv WHERE k = $1", [name]);
        if (rows.length > 0) {
          return JSON.parse(rows[0].v) as StorageValue<T>;
        }
        if (typeof localStorage !== "undefined") {
          const legacy = localStorage.getItem(name);
          if (legacy) {
            try {
              await db.execute(
                "INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = strftime('%s','now') * 1000",
                [name, legacy],
              );
              localStorage.removeItem(name);
              return JSON.parse(legacy) as StorageValue<T>;
            } catch (e) {
              console.warn(`[sqlStorage] migrate ${name} failed`, e);
            }
          }
        }
        return null;
      } catch (e) {
        console.warn(`[sqlStorage] getItem ${name} failed`, e);
        return null;
      }
    },

    async setItem(name, value) {
      try {
        const db = await getDb();
        await db.execute(
          "INSERT INTO kv (k, v, updated_at) VALUES ($1, $2, strftime('%s','now') * 1000) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at",
          [name, JSON.stringify(value)],
        );
      } catch (e) {
        console.warn(`[sqlStorage] setItem ${name} failed`, e);
      }
    },

    async removeItem(name) {
      try {
        const db = await getDb();
        await db.execute("DELETE FROM kv WHERE k = $1", [name]);
      } catch (e) {
        console.warn(`[sqlStorage] removeItem ${name} failed`, e);
      }
    },
  };
}
