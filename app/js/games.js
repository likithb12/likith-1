// Build game rounds from stored words. Pure/offline — no AI, no network.

const FALLBACK_DISTRACTORS = [
  "verbose", "insipid", "candid", "brittle", "opaque", "fervent",
  "languid", "prudent", "austere", "genial", "obscure", "lucid",
];

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function distractorWords(word, bank, n) {
  const pool = bank
    .filter((w) => w.id !== word.id)
    .map((w) => w.word)
    .concat(FALLBACK_DISTRACTORS);
  const seen = new Set([word.word.toLowerCase()]);
  const out = [];
  for (const cand of shuffle(pool)) {
    const k = cand.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(cand);
    }
    if (out.length === n) break;
  }
  return out;
}

// Guess-from-context: blank the word out of one of its example sentences.
export function contextRound(word, bank) {
  const example = word.examples[0] || `The word ${word.word} means ${word.definition}`;
  const re = new RegExp(word.word, "i");
  const blanked = example.replace(re, "＿＿＿＿＿");
  const options = shuffle([word.word, ...distractorWords(word, bank, 3)]);
  return { type: "context", word, prompt: blanked, options, answer: word.word };
}

// Odd-one-out: which word is NOT a synonym of the target?
export function oddOneOutRound(word, bank) {
  const syns = (word.synonyms || []).slice(0, 3);
  // Need at least 2 synonyms to make a fair round; else fall back to context.
  if (syns.length < 2) return contextRound(word, bank);
  const odd = distractorWords(word, bank, 1)[0] || FALLBACK_DISTRACTORS[0];
  const options = shuffle([...syns, odd]);
  return {
    type: "odd",
    word,
    prompt: `Which word is NOT a synonym of “${word.word}”?`,
    options,
    answer: odd,
  };
}

// Alternate game modes across a set of due words.
export function buildRounds(words, bank) {
  return words.map((w, i) =>
    i % 2 === 0 ? contextRound(w, bank) : oddOneOutRound(w, bank)
  );
}
