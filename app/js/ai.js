// Claude integration. All AI calls funnel through here so swapping to a
// serverless proxy later is a one-file change: replace `callClaude`'s
// endpoint/headers and drop the direct-browser header + local key.

import { settings } from "./store.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

export class MissingKeyError extends Error {}

async function callClaude({ system, user, schema, maxTokens = 600 }) {
  const key = settings.getApiKey();
  if (!key) throw new MissingKeyError("No API key set");

  const body = {
    model: settings.getModel(),
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (schema) {
    body.output_config = { format: { type: "json_schema", schema } };
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": VERSION,
      // Required to allow calling the API directly from a browser.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `API error ${res.status}`;
    try {
      const err = await res.json();
      if (err?.error?.message) msg = err.error.message;
    } catch (_) {}
    throw new Error(msg);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return text;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    // Salvage a JSON object if the model wrapped it in prose.
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Could not parse AI response");
  }
}

const WORD_SCHEMA = {
  type: "object",
  properties: {
    word: { type: "string" },
    partOfSpeech: { type: "string" },
    phonetic: { type: "string" },
    definition: { type: "string" },
    examples: { type: "array", items: { type: "string" } },
    synonyms: { type: "array", items: { type: "string" } },
  },
  required: ["word", "partOfSpeech", "phonetic", "definition", "examples", "synonyms"],
  additionalProperties: false,
};

// Generate one fresh vocabulary word for a theme, avoiding known words.
export async function generateWord(theme, knownWords = []) {
  const avoid = knownWords.slice(0, 60).join(", ");
  const text = await callClaude({
    system:
      "You are a vocabulary coach. Produce a single useful, precise English " +
      "word worth learning. Give a clear one-sentence definition, an IPA " +
      "phonetic like /ɪˈfɛm(ə)rəl/, exactly two natural example sentences, " +
      "and 3 close synonyms.",
    user:
      `Theme: ${theme}. Pick one word an motivated adult learner would benefit ` +
      `from. Do NOT choose any of these already-known words: ${avoid || "(none)"}.`,
    schema: WORD_SCHEMA,
    maxTokens: 500,
  });
  return parseJson(text);
}

const GRADE_SCHEMA = {
  type: "object",
  properties: {
    correct: { type: "boolean" },
    feedback: { type: "string" },
  },
  required: ["correct", "feedback"],
  additionalProperties: false,
};

// Grade whether the learner used a word correctly in their sentence.
export async function gradeSentence(word, definition, sentence) {
  const text = await callClaude({
    system:
      "You grade whether a learner used a target vocabulary word correctly " +
      "and naturally in their own sentence. Set correct=true only if the word " +
      "is present AND used with its actual meaning. Keep feedback to one warm, " +
      "specific sentence (a nuance tip if correct, a concrete fix if not).",
    user: `Target word: "${word}"\nMeaning: ${definition}\nLearner's sentence: "${sentence}"`,
    schema: GRADE_SCHEMA,
    maxTokens: 250,
  });
  return parseJson(text);
}
