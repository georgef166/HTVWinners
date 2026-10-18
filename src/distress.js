// Distress check for one 30-second clip, triggered on the phone by a sudden loud spike.
// Privacy rules: the clip lives only in memory for this request and is wiped afterwards;
// the transcript is never stored or logged. Only a score and plain-language cues are kept.
// Transcription runs on our own server (Whisper via an OpenAI-compatible endpoint), never a third party.

const TIMEOUT_MS = Number(process.env.WHISPER_TIMEOUT_MS) || 20000;

// Phrases that suggest someone needs help or is being pushed around. Deliberately narrow.
// danger: 'high' for a plea for help, 'elevated' for aggression. Any of them alerts the contact at once.
const CUES = [
  { key: 'help', label: 'someone shouting for help', re: /\b(help( me)?|somebody help|someone help)\b/i, danger: 'high', weight: 0.4 },
  { key: 'stop', label: 'someone saying stop or get away', re: /\b(stop( it)?|get off( me)?|let (me )?go|leave me alone|don'?t touch( me)?|back off|get away( from me)?)\b/i, danger: 'high', weight: 0.4 },
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
      for (const c of CUES) if (c.re.test(text)) { cues.push(c.label); spoken.push(c.key); score += c.weight; }
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
