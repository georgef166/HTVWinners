// Distress check for one 30-second clip, triggered on the phone by a sudden loud spike.
// Privacy rules: the clip lives only in memory for this request and is wiped afterwards;
// the transcript is never stored or logged. Only a score and plain-language cues are kept.
// Transcription runs on our own server (Whisper via an OpenAI-compatible endpoint), never a third party.

const TIMEOUT_MS = Number(process.env.WHISPER_TIMEOUT_MS) || 20000;

// Phrases that suggest someone needs help or is being pushed around. Deliberately narrow.
// danger: 'high' for a plea for help, 'elevated' for aggression. Any of them alerts the contact at once.
// END = the phrase stands on its own ("Stop!", "Help me."), so "stop by the store" or "can you help me with this" don't count.
const END = String.raw`(?=\s*[!.,?]|\s*$)`;
const CUES = [
  { key: 'help', label: 'someone shouting for help', re: new RegExp(String.raw`\b(somebody|someone|please) help|(?<!\b(can|could|would|will|to|i'?ll|you|we|they|me) )\bhelp( me| us)?(,? please)?${END}`, 'i'), danger: 'high', weight: 0.4 },
  { key: 'stop', label: 'someone saying stop or get away', re: new RegExp(String.raw`\b(?<!don'?t )stop( it| that)?(,? please)?${END}|\bget (the \w+ )?(off( of)? me|away from me|away${END})|\blet (me )?go${END}|\bleave me alone|\bdon'?t touch me|\bback off${END}`, 'i'), danger: 'high', weight: 0.4 },
  { key: 'police', label: 'someone asking for the police', re: /\b(call (the )?(police|cops)|call 911)\b/i, danger: 'high', weight: 0.4 },
  { key: 'aggression', label: 'someone swearing aggressively', re: /\b(f+u+c+k\w*|motherf\w*|shit\w*|bitch\w*|asshole|bastard|cunt)\b/i, danger: 'elevated', weight: 0.3 },
];

async function transcribe(wav) {
  const base = process.env.WHISPER_URL.replace(/\/$/, '');
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'clip.wav');
  form.append('model', process.env.WHISPER_MODEL || 'Systran/faster-whisper-small.en');
  form.append('language', 'en');
  form.append('response_format', 'json');
  // A vocabulary hint: shouted words clip the mic, and a small model guesses better when it expects them.
  form.append('prompt', 'Help! Help me! Somebody help! Stop! Get off me! Get away from me! Leave me alone! Call the police!');
  const res = await fetch(`${base}/v1/audio/transcriptions`, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`whisper ${res.status}`);
  return (await res.json()).text || '';
}

/**
 * @param {Buffer} wav 16-bit mono WAV, at most ~30 s
 * @param {{peakDb?: number, baselineDb?: number}} acoustic loudness the phone measured
 * @returns {Promise<{score: number, cues: string[], spoken: string[], danger: 'high'|'elevated'|null, transcribed: boolean}>}
 */
export async function analyzeClip(wav, { peakDb = null, baselineDb = null } = {}) {
  const cues = [];
  let score = 0;
  // Acoustic: a sharp jump over the room's usual level, or very loud sound.
  const jump = peakDb != null && baselineDb != null ? peakDb - baselineDb : 0;
  if (jump >= 15 || (peakDb != null && peakDb > -10)) { cues.push('a sudden loud noise or shouting'); score += 0.3; }

  let transcribed = false;
  const spoken = [];
  if (process.env.WHISPER_URL && wav?.length) {
    try {
      const text = await transcribe(wav);
      transcribed = true;
      const heard = cuesIn(text);
      cues.push(...heard.cues); spoken.push(...heard.spoken); score += heard.score;
    } catch (err) {
      console.warn(`[distress] transcription unavailable (${err.message}); using loudness only`);
    }
  }
  wav?.fill?.(0); // wipe the audio; nothing about it outlives this request
  return { score: Math.min(1, Math.round(score * 100) / 100), cues, spoken, danger: dangerOf(spoken), transcribed };
}

export function dangerOf(spoken) {
  if (!spoken?.length) return null;
  return spoken.some((k) => CUES.find((c) => c.key === k)?.danger === 'high') ? 'high' : 'elevated';
}

export function cuesIn(text) {
  const hits = CUES.filter((c) => c.re.test(text));
  return { cues: hits.map((c) => c.label), spoken: hits.map((c) => c.key), score: hits.reduce((n, c) => n + c.weight, 0) };
}

// Streaming text has no punctuation, so mid-utterance only phrases that can't mean anything else count
// ("get off me", "somebody help"). Single words like "help" or "stop" wait until the utterance ends on them.
const NOW = [
  { key: 'help', re: /\b(somebody|someone|please) help\b|\bhelp help\b|\bhelp me (please|somebody|someone|now)\b/ },
  { key: 'stop', re: /\b(get (the \w+ )?off( of)? me|get away from me|leave me alone|don'?t touch me|let go of me|stop it|stop stop)\b/ },
  { key: 'police', re: /\b(call (the )?(police|cops)|call 911|call nine one one)\b/ },
  { key: 'aggression', re: /\b(f+u+c+k\w*|motherf\w*|shit\w*|bitch\w*|asshole|bastard|cunt)\b/ },
];

/**
 * Keywords in live, unpunctuated speech. final = the speaker paused, so the utterance ends here.
 * @returns {{cues: string[], spoken: string[], score: number}}
 */
export function spotCues(text, { final = false } = {}) {
  const t = text.toLowerCase();
  const keys = new Set(NOW.filter((c) => c.re.test(t)).map((c) => c.key));
  if (final) for (const k of cuesIn(t).spoken) keys.add(k);
  const hits = CUES.filter((c) => keys.has(c.key));
  return { cues: hits.map((c) => c.label), spoken: hits.map((c) => c.key), score: hits.reduce((n, c) => n + c.weight, 0) };
}
