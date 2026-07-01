import { allWords, putWord, addGeneratedWord, settings, streak } from "./store.js";
import { review, isDue, isMastered, dueLabel, DAY_MS } from "./srs.js";
import { generateWord, gradeSentence, MissingKeyError } from "./ai.js";
import { buildRounds, shuffle } from "./games.js";

// ---- built-in warm-up teasers (offline) ----
const TEASERS = [
  { q: "I speak without a mouth and hear without ears. I have no body, but come alive with wind. What am I?",
    choices: ["A shadow", "An echo", "A dream", "A candle"], answer: 1,
    why: "An echo is reflected sound — it 'speaks' and 'hears' through the air." },
  { q: "What has keys but no locks, space but no room, and lets you enter but not leave?",
    choices: ["A car", "A keyboard", "A map", "A piano"], answer: 1,
    why: "A keyboard: keys, a space bar, and an enter key." },
  { q: "The more of me you take, the more you leave behind. What am I?",
    choices: ["Time", "Footsteps", "Money", "Memories"], answer: 1,
    why: "Each footstep you take leaves another one behind you." },
  { q: "Forward I am heavy, backward I am not. What am I?",
    choices: ["A shadow", "The word 'ton'", "A river", "An anchor"], answer: 1,
    why: "'ton' reversed is 'not'." },
];

const MAX_SESSION_WORDS = 6;
const $ = (s) => document.querySelector(s);
const view = () => $("#view");

let tab = "home";
let bank = [];
let session = null;

// ---------- boot ----------
async function boot() {
  bank = await allWords();
  document.querySelectorAll("#nav button").forEach((b) => {
    b.onclick = () => { tab = b.dataset.tab; syncNav(); render(); };
  });
  syncNav();
  render();
}

function syncNav() {
  document.querySelectorAll("#nav button").forEach((b) =>
    b.classList.toggle("on", b.dataset.tab === tab)
  );
}
function setNav(v) { $("#nav").style.display = v ? "flex" : "none"; }

async function refreshBank() { bank = await allWords(); }

function dueWords() {
  return bank.filter((w) => isDue(w)).sort((a, b) => a.srs.dueDate - b.srs.dueDate);
}

// ---------- render router ----------
function render() {
  $("#streak").textContent = `🔥 ${streak.get()}`;
  if (tab === "home") return renderHome();
  if (tab === "discover") return renderDiscover();
  if (tab === "stats") return renderStats();
  if (tab === "settings") return renderSettings();
}

// ---------- home ----------
function renderHome() {
  setNav(true);
  const due = dueWords();
  const mastered = bank.filter(isMastered).length;
  const total = bank.length;
  const acc = accuracy();

  if (total === 0) {
    view().innerHTML = `<div class="fade center">
      <div class="big-emoji">📖</div>
      <h1>Welcome to Lexicon</h1>
      <p class="muted">Your word bank is empty. Discover a few words to begin — Claude generates them on demand.</p>
      <div class="btns" style="width:100%;margin-top:18px">
        <button class="cta" id="go-discover">✨ Discover words</button>
      </div>
    </div>`;
    $("#go-discover").onclick = () => { tab = "discover"; syncNav(); render(); };
    return;
  }

  view().innerHTML = `<div class="fade">
    <h1>Good to see you 👋</h1>
    <p class="sub"><b style="color:var(--accent)">${due.length}</b> word${due.length === 1 ? "" : "s"} due for review.</p>
    <div class="row" style="margin:14px 0">
      <div class="stat"><div class="n">${total}</div><div class="l">in your bank</div></div>
      <div class="stat"><div class="n">${mastered}</div><div class="l">mastered</div></div>
      <div class="stat"><div class="n">${acc}%</div><div class="l">accuracy</div></div>
    </div>
    <div class="card">
      <div style="font-weight:700;font-size:16px">Today's session</div>
      <p class="sub" style="margin:6px 0 0">1 warm-up teaser · review games · 1 “use it” challenge</p>
      <div style="margin-top:14px"></div>
      <button class="cta" id="start">▶ Start daily session</button>
    </div>
    <h2>Jump into a mode</h2>
    <div class="btns">
      <button class="btn" id="m-teaser">🧩 <div><b>Warm-up teaser</b><div class="muted" style="font-size:12px">A quick logic riddle</div></div></button>
      <button class="btn" id="m-review">🎯 <div><b>Review games</b><div class="muted" style="font-size:12px">${due.length} due</div></div></button>
      <button class="btn" id="m-useit">✍️ <div><b>Use it in a sentence</b> <span class="pill tag-ai">AI graded</span></div></button>
    </div>
  </div>`;

  $("#start").onclick = () => startSession(["teaser", "games", "useit"]);
  $("#m-teaser").onclick = () => startSession(["teaser"]);
  $("#m-review").onclick = () => startSession(["games"]);
  $("#m-useit").onclick = () => startSession(["useit"]);
}

function accuracy() {
  let c = 0, t = 0;
  for (const w of bank) for (const h of w.history) { t++; if (h.correct) c++; }
  return t ? Math.round((c / t) * 100) : 100;
}

// ---------- session engine ----------
function startSession(parts) {
  const words = dueWords().slice(0, MAX_SESSION_WORDS);
  const steps = [];
  if (parts.includes("teaser")) steps.push({ kind: "teaser" });
  if (parts.includes("games")) {
    for (const r of buildRounds(words, bank)) steps.push({ kind: "game", round: r });
  }
  if (parts.includes("useit") && words.length) {
    steps.push({ kind: "useit", word: words[0] });
  }
  steps.push({ kind: "done" });
  session = { steps, i: 0, correct: 0, total: 0 };
  setNav(false);
  runStep();
}

function progressBar() {
  const pct = Math.round((session.i / Math.max(1, session.steps.length - 1)) * 100);
  return `<div class="prog"><i style="width:${pct}%"></i></div>`;
}
function topBar(label) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin:6px 0 4px">
    <button class="ghost" style="width:auto;padding:6px 12px" id="exit">✕ Exit</button>
    <span class="muted" style="font-size:12px">${label}</span>
  </div>${progressBar()}`;
}
function wireExit() { const b = $("#exit"); if (b) b.onclick = exitSession; }
function exitSession() { session = null; tab = "home"; syncNav(); setNav(true); render(); }
function next() { session.i++; runStep(); }

function runStep() {
  const step = session.steps[session.i];
  if (!step || step.kind === "done") return renderDone();
  if (step.kind === "teaser") return renderTeaser();
  if (step.kind === "game") return renderGame(step.round);
  if (step.kind === "useit") return renderUseIt(step.word);
}

// ---------- teaser ----------
function renderTeaser() {
  const t = TEASERS[Math.floor(Math.random() * TEASERS.length)];
  view().innerHTML = `<div class="fade">
    ${topBar("Warm-up teaser")}
    <div class="card">
      <span class="pill">🧠 Lateral thinking</span>
      <p class="def" style="font-size:16px;margin-top:12px">${t.q}</p>
      <div class="btns" id="ch">
        ${t.choices.map((c, i) => `<button class="btn" data-i="${i}">${c}</button>`).join("")}
      </div>
    </div>
  </div>`;
  wireExit();
  document.querySelectorAll("#ch .btn").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.i);
      const ok = i === t.answer;
      session.total++; if (ok) session.correct++;
      document.querySelectorAll("#ch .btn").forEach((b, idx) => {
        b.onclick = null;
        if (idx === t.answer) b.classList.add("correct");
        else if (idx === i) b.classList.add("wrong");
      });
      $(".card").insertAdjacentHTML("beforeend",
        `<div class="feedback ${ok ? "good" : "bad"}">${ok ? "✅ Nice." : "❌ Not quite."} ${t.why}</div>
         <div class="btns"><button class="cta" id="cont">Continue →</button></div>`);
      $("#cont").onclick = next;
    };
  });
}

// ---------- review game ----------
function renderGame(round) {
  const label = round.type === "odd" ? "Review · odd one out" : "Review · guess from context";
  view().innerHTML = `<div class="fade">
    ${topBar(label)}
    <div class="card">
      <span class="pill">${round.type === "odd" ? "🚫 Odd one out" : "🎯 Fill the blank"}</span>
      <p class="def" style="font-size:16px;margin-top:12px">${round.prompt}</p>
      <div class="btns" id="ch">
        ${round.options.map((o) => `<button class="btn">${o}</button>`).join("")}
      </div>
    </div>
    <p class="muted" style="font-size:12px;text-align:center;margin-top:10px">Spaced repetition schedules this word for its next review.</p>
  </div>`;
  wireExit();
  document.querySelectorAll("#ch .btn").forEach((btn) => {
    btn.onclick = () => gradeGame(round, btn.textContent);
  });
}

async function gradeGame(round, chosen) {
  const ok = chosen === round.answer;
  session.total++; if (ok) session.correct++;
  document.querySelectorAll("#ch .btn").forEach((b) => {
    b.onclick = null;
    if (b.textContent === round.answer) b.classList.add("correct");
    else if (b.textContent === chosen) b.classList.add("wrong");
  });

  // Update SRS + history for this word.
  const w = round.word;
  w.srs = review(w.srs, ok ? 4 : 1);
  w.history.push({ mode: round.type, correct: ok, date: Date.now() });
  await putWord(w);

  $(".card").insertAdjacentHTML("beforeend",
    `<div class="feedback ${ok ? "good" : "bad"}">
       <b>${w.word}</b> <span class="phon">${w.phonetic}</span> — ${w.definition}
       ${w.examples[0] ? `<div class="ex" style="margin-top:8px">“${w.examples[0]}”</div>` : ""}
       <div class="muted" style="font-size:12px;margin-top:8px">Next review: ${dueLabel(w)}.</div>
     </div>
     <div class="btns"><button class="cta" id="cont">Continue →</button></div>`);
  $("#cont").onclick = next;
}

// ---------- use it (AI graded) ----------
function renderUseIt(word) {
  view().innerHTML = `<div class="fade">
    ${topBar("Use it · AI graded")}
    <div class="card">
      <div><span class="word">${word.word}</span><span class="phon">${word.phonetic}</span></div>
      <p class="def">${word.definition}</p>
      <p class="sub" style="margin-top:10px">Write a sentence that uses <b>${word.word}</b> correctly:</p>
      <textarea id="inp" placeholder="Type your sentence..."></textarea>
      <div class="btns"><button class="cta" id="submit">Submit for feedback</button></div>
      <div id="fb"></div>
    </div>
  </div>`;
  wireExit();
  $("#submit").onclick = () => submitUseIt(word);
}

async function submitUseIt(word) {
  const txt = ($("#inp").value || "").trim();
  const fb = $("#fb");
  if (!txt) { fb.innerHTML = `<div class="feedback bad">Write something first 🙂</div>`; return; }
  fb.innerHTML = `<div class="grading"><span class="dot"></span> Claude is reading your sentence…</div>`;
  try {
    const { correct, feedback } = await gradeSentence(word.word, word.definition, txt);
    session.total++; if (correct) session.correct++;
    word.srs = review(word.srs, correct ? 5 : 2);
    word.history.push({ mode: "useit", correct, date: Date.now() });
    await putWord(word);
    fb.innerHTML = correct
      ? `<div class="feedback good">✅ ${feedback}</div>
         <div class="btns"><button class="cta" id="cont">Continue →</button></div>`
      : `<div class="feedback bad">⚠️ ${feedback}</div>
         <div class="btns"><button class="ghost" id="retry">Try again</button>
         <button class="cta" id="cont">Skip →</button></div>`;
    const c = $("#cont"); if (c) c.onclick = next;
    const r = $("#retry"); if (r) r.onclick = () => { $("#fb").innerHTML = ""; };
  } catch (e) {
    fb.innerHTML = aiErrorHtml(e);
    wireKeyLink();
  }
}

// ---------- done ----------
function renderDone() {
  const acc = session.total ? Math.round((session.correct / session.total) * 100) : 100;
  const xp = session.correct * 10;
  settings.addXp(xp);
  const s = streak.bump();
  refreshBank();
  view().innerHTML = `<div class="fade center">
    <div class="big-emoji">🎉</div>
    <h1>Session complete!</h1>
    <p class="muted">${session.correct}/${session.total} correct · ${acc}% · streak 🔥 ${s}</p>
    <div class="row" style="width:100%;margin-top:18px">
      <div class="stat"><div class="n">+${xp}</div><div class="l">XP earned</div></div>
      <div class="stat"><div class="n">${dueWords().length}</div><div class="l">still due</div></div>
    </div>
    <div class="btns" style="width:100%;margin-top:20px">
      <button class="cta" id="home">Back to home</button>
    </div>
  </div>`;
  $("#home").onclick = exitSession;
}

// ---------- discover ----------
const THEMES = ["Everyday elegance", "Business & persuasion", "Emotions & mood", "GRE / advanced", "Surprise me"];
function renderDiscover() {
  setNav(true);
  view().innerHTML = `<div class="fade">
    <h1>Discover ✨</h1>
    <p class="sub">Tap a theme — Claude generates a fresh word and adds it to your bank.</p>
    <div class="btns">
      ${THEMES.map((t) => `<button class="btn" data-t="${t}">🎲 <b>${t}</b></button>`).join("")}
    </div>
    <div id="gen"></div>
  </div>`;
  document.querySelectorAll("[data-t]").forEach((b) => {
    b.onclick = () => genWord(b.dataset.t);
  });
}

async function genWord(theme) {
  const g = $("#gen");
  g.innerHTML = `<div class="grading" style="margin-top:16px"><span class="dot"></span> Claude is generating a word…</div>`;
  try {
    const known = bank.map((w) => w.word);
    const w = await generateWord(theme, known);
    g.innerHTML = `<div class="card fade" style="margin-top:14px">
      <div><span class="word">${w.word}</span><span class="phon">${w.phonetic || ""}</span></div>
      ${w.partOfSpeech ? `<div class="pill" style="margin-top:8px">${w.partOfSpeech}</div>` : ""}
      <p class="def">${w.definition}</p>
      ${(w.examples || []).map((e) => `<div class="ex">“${e}”</div>`).join("")}
      ${(w.synonyms || []).length ? `<p class="sub" style="margin-top:10px">Synonyms: ${w.synonyms.join(", ")}</p>` : ""}
      <div class="btns"><button class="cta" id="add">＋ Add to my word bank</button></div>
    </div>`;
    $("#add").onclick = async () => {
      const rec = await addGeneratedWord(w);
      await refreshBank();
      $("#gen").innerHTML = rec
        ? `<div class="feedback good" style="margin-top:14px">✅ Added — it'll appear in your next review.</div>`
        : `<div class="feedback bad" style="margin-top:14px">You already have that word.</div>`;
    };
  } catch (e) {
    g.innerHTML = aiErrorHtml(e);
    wireKeyLink();
  }
}

// ---------- stats ----------
function renderStats() {
  setNav(true);
  const mastered = bank.filter(isMastered).length;
  const learning = bank.length - mastered;
  const weak = [...bank]
    .sort((a, b) => (a.srs.dueDate - b.srs.dueDate))
    .slice(0, 6);

  // 5-week activity heatmap from review history.
  const days = 35;
  const counts = new Array(days).fill(0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  for (const w of bank) for (const h of w.history) {
    const d = new Date(h.date); d.setHours(0, 0, 0, 0);
    const idx = days - 1 - Math.round((now - d) / DAY_MS);
    if (idx >= 0 && idx < days) counts[idx]++;
  }

  view().innerHTML = `<div class="fade">
    <h1>Your progress 📊</h1>
    <div class="row" style="margin:14px 0">
      <div class="stat"><div class="n">${mastered}</div><div class="l">mastered</div></div>
      <div class="stat"><div class="n">${learning}</div><div class="l">learning</div></div>
      <div class="stat"><div class="n">${settings.getXp()}</div><div class="l">total XP</div></div>
    </div>
    <div class="card">
      <div style="font-weight:700">Review activity</div>
      <p class="sub" style="margin:4px 0 12px">Last 5 weeks</p>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
        ${counts.map((c) => `<div title="${c} reviews" style="aspect-ratio:1;border-radius:5px;background:${c ? "linear-gradient(135deg,#6ea8fe,#8b7cff)" : "#1b2431"};opacity:${c ? Math.min(1, 0.4 + c * 0.2) : 1}"></div>`).join("")}
      </div>
    </div>
    <div class="card">
      <div style="font-weight:700;margin-bottom:8px">Words to strengthen</div>
      ${bank.length === 0 ? `<p class="muted">Nothing yet — discover some words.</p>` :
        weak.map((w) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)">
          <span><b>${w.word}</b> <span class="muted" style="font-size:12px">${w.partOfSpeech}</span></span>
          <span class="muted" style="font-size:12px">${dueLabel(w)}</span></div>`).join("")}
    </div>
  </div>`;
}

// ---------- settings ----------
function renderSettings() {
  setNav(true);
  const hasKey = !!settings.getApiKey();
  const model = settings.getModel();
  const models = [
    ["claude-haiku-4-5", "Haiku 4.5 — fast & cheap (recommended)"],
    ["claude-sonnet-5", "Sonnet 5 — higher quality"],
    ["claude-opus-4-8", "Opus 4.8 — most capable"],
  ];
  view().innerHTML = `<div class="fade">
    <h1>Settings ⚙️</h1>
    <div class="card">
      <div style="font-weight:700">Anthropic API key</div>
      <p class="sub" style="margin:6px 0 10px">Stored only on this device. Get one at <span class="link">console.anthropic.com</span>.</p>
      <input type="password" id="key" placeholder="sk-ant-..." value="${settings.getApiKey()}" />
      <div class="btns"><button class="cta" id="save">Save key</button></div>
      <p class="muted" style="font-size:12px;margin-top:8px">${hasKey ? "✅ A key is saved." : "⚠️ No key yet — Discover & “Use it” need one."}</p>
    </div>
    <div class="card">
      <div style="font-weight:700;margin-bottom:8px">Model</div>
      <select id="model">
        ${models.map(([v, l]) => `<option value="${v}" ${v === model ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </div>
    <div class="card">
      <div style="font-weight:700">About</div>
      <p class="sub" style="margin-top:6px">Lexicon runs entirely on your device. Reviews work offline; only word generation and sentence grading call Claude.</p>
    </div>
  </div>`;
  $("#save").onclick = () => {
    settings.setApiKey($("#key").value);
    renderSettings();
  };
  $("#model").onchange = (e) => settings.setModel(e.target.value);
}

// ---------- shared AI error UI ----------
function aiErrorHtml(e) {
  if (e instanceof MissingKeyError) {
    return `<div class="feedback bad" style="margin-top:12px">No API key set. <span class="link" id="tolink">Add one in Settings</span> to use AI features.</div>`;
  }
  return `<div class="feedback bad" style="margin-top:12px">${e.message || "Something went wrong."}</div>`;
}
function wireKeyLink() {
  const l = $("#tolink");
  if (l) l.onclick = () => { session = null; tab = "settings"; syncNav(); setNav(true); render(); };
}

// ---------- service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}

boot();
