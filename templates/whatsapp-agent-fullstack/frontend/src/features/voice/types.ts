/** Who provides the voice: nobody, or Amazon Polly (answers) with Amazon Transcribe (voice notes). */
export type VoiceProvider = 'none' | 'polly';

/** When an answer is also sent as audio. */
export type ReplyMode = 'off' | 'voice_notes' | 'always';

/** What `GET /whatsapp/voice` returns (src/lambda/whatsapp/voice-config in the backend). */
export interface VoiceSettings {
  provider: VoiceProvider;
  replyWithAudio: ReplyMode;
  voiceId: string;
  engine: string;
  transcribeLanguage: string;
  updatedBy?: string;
  updatedAt?: string;
}

/** A Spanish Amazon Polly voice. */
export interface PollyVoice {
  id: string;
  name: string;
  gender: string;
  languageCode: string;
  languageName: string;
  /** Engines this voice supports, best first. */
  engines: string[];
}

export interface TranscribeLanguage {
  code: string;
  label: string;
}

export interface VoiceState {
  settings: VoiceSettings;
  voices: PollyVoice[];
  languages: TranscribeLanguage[];
}

export const PROVIDER_OPTIONS: { id: VoiceProvider; label: string; hint: string }[] = [
  {
    id: 'polly',
    label: 'Amazon Polly',
    hint: 'Transcribe las notas de voz que llegan y puede responder con audio.',
  },
  {
    id: 'none',
    label: 'Ninguna',
    hint: 'Solo texto: el agente no entiende notas de voz ni responde con audio.',
  },
];

export const REPLY_OPTIONS: { id: ReplyMode; label: string }[] = [
  { id: 'voice_notes', label: 'Solo cuando el cliente envía una nota de voz' },
  { id: 'always', label: 'En todas las respuestas' },
  { id: 'off', label: 'Nunca: solo entender las notas de voz' },
];

export const ENGINE_LABELS: Record<string, string> = {
  neural: 'Neural (natural, recomendado)',
  generative: 'Generativa (la más natural, mayor costo)',
  standard: 'Estándar (económica, más robótica)',
  'long-form': 'Larga duración',
};

export const engineLabel = (engine: string) => ENGINE_LABELS[engine] ?? engine;

export const genderLabel = (gender: string) =>
  gender === 'Female' ? 'Femenina' : gender === 'Male' ? 'Masculina' : gender;

/** The voices grouped by accent, in the order the backend sends them (es-US first). */
export function groupVoices(voices: PollyVoice[]): { label: string; voices: PollyVoice[] }[] {
  const groups: { label: string; voices: PollyVoice[] }[] = [];
  for (const voice of voices) {
    const group = groups.find(item => item.label === voice.languageName);
    if (group) group.voices.push(voice);
    else groups.push({ label: voice.languageName, voices: [voice] });
  }
  return groups;
}

/** The engine to keep when the voice changes: the same one if the new voice has it, else its best. */
export function engineFor(voice: PollyVoice | undefined, current: string): string {
  if (!voice || voice.engines.length === 0) return current;
  return voice.engines.includes(current) ? current : (voice.engines[0] ?? current);
}
