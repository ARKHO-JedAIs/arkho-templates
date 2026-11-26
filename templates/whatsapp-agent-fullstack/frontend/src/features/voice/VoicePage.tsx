import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AudioLines, Loader2, Play, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useCan } from '@/lib/access/permissions';
import type { VoiceSettings, VoiceState } from './types';
import {
  PROVIDER_OPTIONS,
  REPLY_OPTIONS,
  engineFor,
  engineLabel,
  genderLabel,
  groupVoices,
} from './types';
import { VoiceAuthError, fetchVoice, previewVoice, saveVoice } from './voiceService';
import { FormSkeleton } from '@/components/skeletons';

type Choice = Pick<
  VoiceSettings,
  'provider' | 'replyWithAudio' | 'voiceId' | 'engine' | 'transcribeLanguage'
>;

const CARD_CLASS = 'grid content-start gap-4 rounded-xl border border-border bg-card p-5';
const SELECT_CLASS = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

const pick = ({
  provider,
  replyWithAudio,
  voiceId,
  engine,
  transcribeLanguage,
}: VoiceSettings): Choice => ({ provider, replyWithAudio, voiceId, engine, transcribeLanguage });

const sameChoice = (a: Choice, b: Choice) =>
  a.provider === b.provider &&
  a.replyWithAudio === b.replyWithAudio &&
  a.voiceId === b.voiceId &&
  a.engine === b.engine &&
  a.transcribeLanguage === b.transcribeLanguage;

/**
 * The agent's voice: who provides it (none, or Amazon Polly with Amazon
 * Transcribe), the voice that reads answers aloud, when answers also go as
 * audio, and the language voice notes are heard in. Saved at once; the agent
 * picks it up within a minute, without a deploy.
 */
export default function VoicePage() {
  const navigate = useNavigate();
  const canEdit = useCan('voice');
  const [state, setState] = useState<VoiceState | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [sample, setSample] = useState('');
  const player = useRef<HTMLAudioElement>(null);

  const fail = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof VoiceAuthError) {
        void navigate({ to: '/login' });
        return;
      }
      toast.error(err instanceof Error ? err.message : fallback);
    },
    [navigate]
  );

  useEffect(() => {
    let active = true;
    fetchVoice()
      .then(data => {
        if (!active) return;
        setState(data);
        setChoice(pick(data.settings));
      })
      .catch(err => {
        if (!active) return;
        if (err instanceof VoiceAuthError) {
          void navigate({ to: '/login' });
          return;
        }
        setError(err instanceof Error ? err.message : 'No se pudo leer la configuración de voz.');
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (sample) void player.current?.play().catch(() => undefined);
  }, [sample]);

  const groups = useMemo(() => groupVoices(state?.voices ?? []), [state]);
  const selected = state?.voices.find(voice => voice.id === choice?.voiceId);
  const dirty = !!choice && !!state && !sameChoice(choice, pick(state.settings));

  const chooseVoice = (voiceId: string) => {
    const voice = state?.voices.find(item => item.id === voiceId);
    setChoice(current =>
      current ? { ...current, voiceId, engine: engineFor(voice, current.engine) } : current
    );
    setSample('');
  };

  const listen = async () => {
    if (!choice) return;
    setPreviewing(true);
    try {
      setSample(await previewVoice(choice.voiceId, choice.engine));
    } catch (err) {
      fail(err, 'No se pudo generar la muestra.');
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    if (!choice) return;
    setSaving(true);
    try {
      const data = await saveVoice(choice);
      setState(data);
      setChoice(pick(data.settings));
      toast.success('Voz guardada. El agente la usa desde el próximo mensaje.');
    } catch (err) {
      fail(err, 'No se pudo guardar la voz.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='flex flex-col gap-5'>
      <div className='max-w-2xl'>
        <h1 className='flex items-center gap-2.5 text-2xl font-bold leading-tight text-foreground'>
          <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-light text-primary'>
            <AudioLines className='h-5 w-5' aria-hidden />
          </span>
          Voz
        </h1>
        <p className='mt-1 text-sm text-foreground-secondary'>
          Elige si el agente usa voz, con qué voz responde y cuándo lo hace por audio. Se aplica al
          guardar, sin desplegar.
        </p>
      </div>

      {error ? (
        <p className='rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
          {error}
        </p>
      ) : null}

      {!state || !choice ? (
        !error ? (
          <div className='rounded-xl border border-border bg-card p-5'>
            <FormSkeleton fields={3} label='Cargando voces' />
          </div>
        ) : null
      ) : (
        <div className='grid gap-5'>
          <section className={CARD_CLASS}>
            <h2 className='text-base font-semibold text-foreground'>Proveedor de voz</h2>
            <div role='radiogroup' aria-label='Proveedor de voz' className='flex flex-col gap-2'>
              {PROVIDER_OPTIONS.map(option => (
                <div
                  key={option.id}
                  className='flex items-start gap-3 rounded-xl border border-border bg-background p-3 has-[:checked]:border-primary'
                >
                  <input
                    id={`voice-provider-${option.id}`}
                    type='radio'
                    name='voice-provider'
                    value={option.id}
                    checked={choice.provider === option.id}
                    disabled={!canEdit}
                    onChange={() => {
                      setChoice({ ...choice, provider: option.id });
                      setSample('');
                    }}
                    className='mt-1'
                  />
                  <div className='flex flex-col gap-0.5'>
                    <Label htmlFor={`voice-provider-${option.id}`} className='cursor-pointer'>
                      {option.label}
                    </Label>
                    <p className='text-xs text-muted-foreground'>{option.hint}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {choice.provider === 'polly' ? (
            <div className='grid items-start gap-5 lg:grid-cols-2'>
              <section className={CARD_CLASS}>
                <h2 className='text-base font-semibold text-foreground'>Voz de las respuestas</h2>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='voice-id'>Voz</Label>
                  <p className='-mt-1 text-xs text-muted-foreground'>
                    Voces de Amazon Polly en español. No hay acento chileno: la más cercana es la
                    latina de EE.UU.
                  </p>
                  <select
                    id='voice-id'
                    value={choice.voiceId}
                    disabled={!canEdit}
                    onChange={e => chooseVoice(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {groups.map(group => (
                      <optgroup key={group.label} label={group.label}>
                        {group.voices.map(voice => (
                          <option key={voice.id} value={voice.id}>
                            {voice.name} · {genderLabel(voice.gender)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='voice-engine'>Motor</Label>
                  <select
                    id='voice-engine'
                    value={choice.engine}
                    disabled={!canEdit}
                    onChange={e => {
                      setChoice({ ...choice, engine: e.target.value });
                      setSample('');
                    }}
                    className={SELECT_CLASS}
                  >
                    {(selected?.engines ?? [choice.engine]).map(engine => (
                      <option key={engine} value={engine}>
                        {engineLabel(engine)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='voice-reply'>Responder con audio</Label>
                  <select
                    id='voice-reply'
                    value={choice.replyWithAudio}
                    disabled={!canEdit}
                    onChange={e =>
                      setChoice({
                        ...choice,
                        replyWithAudio: e.target.value as Choice['replyWithAudio'],
                      })
                    }
                    className={SELECT_CLASS}
                  >
                    {REPLY_OPTIONS.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className='text-xs text-muted-foreground'>
                    El audio se envía además de la respuesta escrita.
                  </p>
                </div>

                <div className='flex flex-wrap items-center gap-3'>
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => void listen()}
                    disabled={previewing}
                  >
                    {previewing ? (
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' aria-hidden />
                    ) : (
                      <Play className='mr-2 h-4 w-4' aria-hidden />
                    )}
                    Escuchar
                  </Button>
                  {sample ? (
                    <audio ref={player} controls src={sample} className='h-10 max-w-full'>
                      <track kind='captions' />
                    </audio>
                  ) : null}
                </div>
              </section>

              <section className={CARD_CLASS}>
                <h2 className='text-base font-semibold text-foreground'>Audios que recibe</h2>
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='voice-language'>Idioma de transcripción</Label>
                  <p className='-mt-1 text-xs text-muted-foreground'>
                    Con qué variante de español Amazon Transcribe convierte a texto las notas de voz
                    que llegan por WhatsApp.
                  </p>
                  <select
                    id='voice-language'
                    value={choice.transcribeLanguage}
                    disabled={!canEdit}
                    onChange={e => setChoice({ ...choice, transcribeLanguage: e.target.value })}
                    className={SELECT_CLASS}
                  >
                    {state.languages.map(language => (
                      <option key={language.code} value={language.code}>
                        {language.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
            </div>
          ) : null}

          <div className='flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4'>
            <p className='text-xs text-muted-foreground'>
              {state.settings.updatedAt
                ? `Último cambio: ${new Date(state.settings.updatedAt).toLocaleString()}${
                    state.settings.updatedBy ? ` por ${state.settings.updatedBy}` : ''
                  }`
                : 'Usando la configuración por defecto.'}
            </p>
            <Button
              type='button'
              onClick={() => void save()}
              disabled={!canEdit || !dirty || saving}
            >
              {saving ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' aria-hidden />
              ) : (
                <Save className='mr-2 h-4 w-4' aria-hidden />
              )}
              Guardar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
