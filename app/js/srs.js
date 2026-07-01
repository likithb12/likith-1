// Spaced-repetition scheduler (SM-2 variant).
// Pure functions — no storage, no DOM. This is the retention engine.

export const DAY_MS = 24 * 60 * 60 * 1000;

// A fresh card starts due immediately with default ease.
export function newCard() {
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, dueDate: Date.now() };
}

// quality: 0..5. In games we map correct -> 4, incorrect -> 1.
// Returns a new srs object (does not mutate the input).
export function review(srs, quality) {
  let { ease, interval, reps, lapses } = srs;

  if (quality < 3) {
    // Lapse: relearn tomorrow, keep some of the ease.
    reps = 0;
    interval = 1;
    lapses += 1;
  } else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ease);
    reps += 1;
  }

  // Adjust ease factor; floor at 1.3.
  ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ease < 1.3) ease = 1.3;

  return { ease, interval, reps, lapses, dueDate: Date.now() + interval * DAY_MS };
}

export function isDue(card, now = Date.now()) {
  return card.srs.dueDate <= now;
}

// A word is "mastered" once it's survived a few reps with a long interval.
export function isMastered(card) {
  return card.srs.reps >= 4 && card.srs.interval >= 21;
}

// Human-friendly "next review" label.
export function dueLabel(card, now = Date.now()) {
  const diff = card.srs.dueDate - now;
  if (diff <= 0) return "due now";
  const days = Math.ceil(diff / DAY_MS);
  if (days <= 1) return "due tomorrow";
  return `due in ${days} days`;
}
