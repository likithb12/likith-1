// Local persistence. Word bank + review history live in IndexedDB;
// settings (API key, model, streak) live in localStorage.
// Nothing here leaves the device.

import { newCard } from "./srs.js";

const DB_NAME = "lexicon";
const DB_VERSION = 1;
const STORE = "words";

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("word", "word", { unique: false });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function tx(mode) {
  return open().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

export async function allWords() {
  const os = await tx("readonly");
  return new Promise((resolve, reject) => {
    const req = os.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putWord(word) {
  const os = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const req = os.put(word);
    req.onsuccess = () => resolve(word);
    req.onerror = () => reject(req.error);
  });
}

// Add a freshly generated word (from AI) into the bank with a new SRS card.
export async function addGeneratedWord(w) {
  const existing = await allWords();
  if (existing.some((e) => e.word.toLowerCase() === w.word.toLowerCase())) {
    return null; // already have it
  }
  const record = {
    id: crypto.randomUUID(),
    word: w.word,
    partOfSpeech: w.partOfSpeech || "",
    phonetic: w.phonetic || "",
    definition: w.definition || "",
    examples: Array.isArray(w.examples) ? w.examples : [],
    synonyms: Array.isArray(w.synonyms) ? w.synonyms : [],
    srs: newCard(),
    history: [],
    addedAt: Date.now(),
  };
  await putWord(record);
  return record;
}

export async function recordReview(id, mode, correct) {
  const os = await tx("readwrite");
  const word = await new Promise((res, rej) => {
    const r = os.get(id);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  if (!word) return;
  word.history.push({ mode, correct, date: Date.now() });
  await putWord(word);
}

// ---- settings (localStorage) ----
const LS = {
  key: "lexicon.apiKey",
  model: "lexicon.model",
  streak: "lexicon.streak",
  lastDay: "lexicon.lastActiveDay",
  xp: "lexicon.xp",
};

export const settings = {
  getApiKey: () => localStorage.getItem(LS.key) || "",
  setApiKey: (v) => localStorage.setItem(LS.key, v.trim()),
  getModel: () => localStorage.getItem(LS.model) || "claude-haiku-4-5",
  setModel: (v) => localStorage.setItem(LS.model, v),
  getXp: () => Number(localStorage.getItem(LS.xp) || 0),
  addXp: (n) => localStorage.setItem(LS.xp, String(settings.getXp() + n)),
};

// Streak: increment when a session completes on a new calendar day.
export const streak = {
  get: () => Number(localStorage.getItem(LS.streak) || 0),
  // Call on session completion. Returns the (possibly updated) streak.
  bump() {
    const today = new Date().toDateString();
    const last = localStorage.getItem(LS.lastDay);
    let s = streak.get();
    if (last === today) return s; // already counted today
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    s = last === yesterday ? s + 1 : 1; // continue or reset
    localStorage.setItem(LS.streak, String(s));
    localStorage.setItem(LS.lastDay, today);
    return s;
  },
};
