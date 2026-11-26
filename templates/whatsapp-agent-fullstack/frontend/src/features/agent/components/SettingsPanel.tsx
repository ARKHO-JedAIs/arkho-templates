import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCan } from '@/lib/access/permissions';
import {
  LIMITS,
  fetchAgentSettings,
  saveAgentSettings,
  type AgentSettings,
  type MemoryMode,
} from '../agentSettingsService';

const MEMORY_OPTIONS: { id: MemoryMode; label: string; hint: string }[] = [
  {
    id: 'window',
    label: 'Mantener la conversación un tiempo',
    hint: 'El agente recuerda lo hablado mientras el cliente siga escribiendo. Si pasa más tiempo sin mensajes, la siguiente conversación empieza limpia.',
  },
  {
    id: 'each_message',
    label: 'Empezar limpio en cada consulta',
    hint: 'Cada mensaje se responde sin el historial anterior. Sirve para consultas sueltas, como un estado o un dato puntual.',
  },
  {
    id: 'off',
    label: 'Sin memoria',
    hint: 'El agente no lee ni guarda nada de las conversaciones.',
  },
];

function describeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} días`;
}

function whole(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function sameSettings(a: AgentSettings, b: AgentSettings): boolean {
  return (
    a.memory.mode === b.memory.mode &&
    a.memory.minutes === b.memory.minutes &&
    a.rateLimit.enabled === b.rateLimit.enabled &&
    a.rateLimit.perHour === b.rateLimit.perHour
  );
}

/**
 * How much the agent remembers and how often it answers. Unlike the other tabs
 * these are not a draft to publish: saving applies them within a minute.
 */
export function SettingsPanel() {
  const canEdit = useCan('agent.settings');
  const [saved, setSaved] = useState<AgentSettings | null>(null);
  const [form, setForm] = useState<AgentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const settings = await fetchAgentSettings();
      setSaved(settings);
      setForm(settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la configuración.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className='flex max-w-3xl flex-col items-start gap-3'>
        <p className='text-sm text-destructive'>{error}</p>
        <Button variant='outline' onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!form || !saved) {
    return (
      <div role='status' aria-label='Cargando configuración' className='grid max-w-3xl gap-4'>
        <Skeleton className='h-32 w-full rounded-xl' />
        <Skeleton className='h-24 w-full rounded-xl' />
      </div>
    );
  }

  const minutes = form.memory.minutes;
  const perHour = form.rateLimit.perHour;
  const minutesOk =
    Number.isInteger(minutes) && minutes >= LIMITS.minMinutes && minutes <= LIMITS.maxMinutes;
  const perHourOk =
    Number.isInteger(perHour) && perHour >= LIMITS.minPerHour && perHour <= LIMITS.maxPerHour;
  const valid =
    (form.memory.mode !== 'window' || minutesOk) && (!form.rateLimit.enabled || perHourOk);
  const dirty = !sameSettings(form, saved);
  const longTerm = form.longTermMemory === 'facts' || form.longTermMemory === 'facts_summaries';

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveAgentSettings({
        memory: { mode: form.memory.mode, minutes: minutesOk ? minutes : saved.memory.minutes },
        rateLimit: {
          enabled: form.rateLimit.enabled,
          perHour: perHourOk ? perHour : saved.rateLimit.perHour,
        },
      });
      setSaved(next);
      setForm(next);
      toast.success('Configuración guardada. Se aplica en menos de un minuto.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='grid max-w-3xl gap-6'>
      <section className='flex flex-col gap-3'>
        <div>
          <h2 className='text-base font-semibold text-foreground'>Memoria</h2>
          <p className='text-xs text-muted-foreground'>
            Cuánto de la conversación recuerda el agente al responder.
          </p>
        </div>
        <div role='radiogroup' aria-label='Memoria del agente' className='flex flex-col gap-2'>
          {MEMORY_OPTIONS.map(option => (
            <div
              key={option.id}
              className='flex items-start gap-3 rounded-xl border border-border bg-card p-3 has-[:checked]:border-primary'
            >
              <input
                id={`agent-memory-${option.id}`}
                type='radio'
                name='agent-memory-mode'
                value={option.id}
                checked={form.memory.mode === option.id}
                disabled={!canEdit}
                onChange={() => setForm({ ...form, memory: { ...form.memory, mode: option.id } })}
                className='mt-1'
              />
              <div className='flex flex-col gap-0.5'>
                <Label htmlFor={`agent-memory-${option.id}`} className='cursor-pointer'>
                  {option.label}
                </Label>
                <p className='text-xs text-muted-foreground'>{option.hint}</p>
              </div>
            </div>
          ))}
        </div>
        {form.memory.mode === 'window' ? (
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='agent-memory-minutes'>Minutos sin mensajes para empezar de nuevo</Label>
            <div className='flex items-center gap-3'>
              <Input
                id='agent-memory-minutes'
                type='number'
                min={LIMITS.minMinutes}
                max={LIMITS.maxMinutes}
                value={Number.isNaN(minutes) ? '' : minutes}
                disabled={!canEdit}
                onChange={event =>
                  setForm({
                    ...form,
                    memory: { ...form.memory, minutes: whole(event.target.value) },
                  })
                }
                className='w-32'
              />
              <span className='text-xs text-muted-foreground'>
                {minutesOk
                  ? `= ${describeMinutes(minutes)}`
                  : `Entre ${LIMITS.minMinutes} y ${LIMITS.maxMinutes} minutos`}
              </span>
            </div>
          </div>
        ) : null}
        {longTerm ? (
          <p className='text-xs text-muted-foreground'>
            Además, el agente guarda datos del cliente entre conversaciones (se eligió al
            desplegar). &quot;Sin memoria&quot; también lo desactiva; las otras opciones lo
            mantienen.
          </p>
        ) : null}
      </section>

      <section className='flex flex-col gap-3'>
        <div className='flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4'>
          <div>
            <h2 className='text-base font-semibold text-foreground'>Límite de respuestas</h2>
            <p className='text-xs text-muted-foreground'>
              Máximo de respuestas del agente por cliente en una hora. Pasado el máximo, el cliente
              recibe un aviso y una persona puede revisar la conversación.
            </p>
          </div>
          <Switch
            checked={form.rateLimit.enabled}
            disabled={!canEdit}
            aria-label='Limitar las respuestas por hora'
            onCheckedChange={enabled =>
              setForm({ ...form, rateLimit: { ...form.rateLimit, enabled } })
            }
          />
        </div>
        {form.rateLimit.enabled ? (
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='agent-rate-limit'>Respuestas por cliente y hora</Label>
            <Input
              id='agent-rate-limit'
              type='number'
              min={LIMITS.minPerHour}
              max={LIMITS.maxPerHour}
              value={Number.isNaN(perHour) ? '' : perHour}
              disabled={!canEdit}
              onChange={event =>
                setForm({
                  ...form,
                  rateLimit: { ...form.rateLimit, perHour: whole(event.target.value) },
                })
              }
              className='w-32'
            />
            {!perHourOk ? (
              <p className='text-xs text-destructive'>
                Entre {LIMITS.minPerHour} y {LIMITS.maxPerHour}
              </p>
            ) : null}
          </div>
        ) : (
          <p className='text-xs text-muted-foreground'>
            Sin límite: el agente responde cada mensaje.
          </p>
        )}
      </section>

      <div className='flex items-center gap-3'>
        <Button onClick={() => void save()} disabled={!canEdit || !dirty || !valid || saving}>
          <Save className='h-4 w-4' aria-hidden />
          Guardar
        </Button>
        {!canEdit ? (
          <p className='text-xs text-muted-foreground'>
            No tienes permiso para cambiar esta configuración.
          </p>
        ) : null}
      </div>
    </div>
  );
}
