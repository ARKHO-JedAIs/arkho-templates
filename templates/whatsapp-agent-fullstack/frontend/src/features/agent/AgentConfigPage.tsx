import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  Braces,
  Cpu,
  ExternalLink,
  History,
  MessageSquareText,
  ScrollText,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  AgentConfigAuthError,
  discardDraft,
  fetchAgentConfig,
  publishDraft,
  saveDraft,
} from './agentConfigService';
import { ModelPanel } from './components/ModelPanel';
import { ParametersPanel } from './components/ParametersPanel';
import { VersionHistory } from './components/VersionHistory';
import { formatDate } from './format';
import { LIMITS, sameValue, variablesOf, type AgentConfig, type AgentConfigState } from './types';

type Tab = 'instructions' | 'messages' | 'parameters' | 'model' | 'history';

const TABS: { id: Tab; label: string; icon: typeof ScrollText }[] = [
  { id: 'instructions', label: 'Instrucciones', icon: ScrollText },
  { id: 'messages', label: 'Mensajes', icon: MessageSquareText },
  { id: 'parameters', label: 'Parámetros', icon: Braces },
  { id: 'model', label: 'Modelo', icon: Cpu },
  { id: 'history', label: 'Historial', icon: History },
];

const sameConfig = (a: AgentConfig, b: AgentConfig) => sameValue(a, b);

/** The prompt in the Bedrock console (Prompt management). */
const consoleUrl = (arn: string) => {
  const region = arn.split(':')[3] || 'us-east-1';
  return `https://${region}.console.aws.amazon.com/bedrock/home?region=${region}#/prompt-management`;
};

/**
 * The prompt manager: what the WhatsApp agent knows about the business and how
 * it answers. Changes go to a draft that the agent does not see; publishing
 * makes it live within a minute, and every version stays in the history.
 */
export function AgentConfigPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<AgentConfigState | null>(null);
  const [form, setForm] = useState<AgentConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('instructions');
  const [busy, setBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [comment, setComment] = useState('');

  const handleError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof AgentConfigAuthError) {
        toast.error(err.message);
        navigate({ to: '/login' });
        return;
      }
      toast.error(err instanceof Error ? err.message : fallback);
    },
    [navigate]
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchAgentConfig();
      setState(data);
      setForm(data.draft?.config ?? data.published.config);
    } catch (err) {
      if (err instanceof AgentConfigAuthError) handleError(err, '');
      else setError(err instanceof Error ? err.message : 'No se pudo cargar la configuración.');
    }
  }, [handleError]);

  useEffect(() => {
    void load();
  }, [load]);

  const saved = state ? (state.draft?.config ?? state.published.config) : null;
  const dirty = Boolean(form && saved && !sameConfig(form, saved));
  const hasDraft = Boolean(state?.draft);
  const differsFromPublished = Boolean(form && state && !sameConfig(form, state.published.config));

  const problems = useMemo(() => {
    if (!form) return [];
    const list: string[] = [];
    if (form.businessName.trim().length < 2) list.push('El nombre del negocio es obligatorio.');
    if (form.instructions.trim().length < LIMITS.instructionsMin)
      list.push(`Las instrucciones necesitan al menos ${LIMITS.instructionsMin} caracteres.`);
    if (form.instructions.length > LIMITS.instructions)
      list.push(`Las instrucciones superan los ${LIMITS.instructions} caracteres.`);
    for (const [key, label] of [
      ['greeting', 'saludo'],
      ['refusal', 'mensaje fuera de tema'],
      ['handoffMessage', 'mensaje de derivación'],
    ] as const) {
      if (!form[key].trim()) list.push(`Falta el ${label}.`);
    }
    const missing = variablesOf(form.instructions).filter(name => !form.parameters[name]?.trim());
    if (missing.length > 0)
      list.push(
        `Falta el valor de ${missing.map(name => `{{${name}}}`).join(', ')} en Parámetros.`
      );
    if (form.model.maxTokens < 256 || form.model.maxTokens > 8192)
      list.push('El largo máximo debe estar entre 256 y 8.192 tokens.');
    return list;
  }, [form]);

  const update = <K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) =>
    setForm(current => (current ? { ...current, [key]: value } : current));

  const handleSave = async (): Promise<number | null> => {
    if (!form || !state) return null;
    setBusy(true);
    try {
      const draft = await saveDraft(form, state.draft?.revision);
      setState({ ...state, draft });
      toast.success('Borrador guardado. El agente sigue usando la versión publicada.');
      return draft.revision;
    } catch (err) {
      handleError(err, 'No se pudo guardar el borrador');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    setBusy(true);
    try {
      await discardDraft();
      toast.success('Borrador descartado');
      await load();
    } catch (err) {
      handleError(err, 'No se pudo descartar el borrador');
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!state) return;
    // Unsaved edits are saved first, so what gets published is what is on screen.
    const revision = dirty || !state.draft ? await handleSave() : state.draft.revision;
    if (revision === null) return;
    setBusy(true);
    try {
      const version = await publishDraft(comment.trim(), revision);
      toast.success(`Publicada la ${version.version}. El agente la usa en menos de un minuto.`);
      setPublishOpen(false);
      setComment('');
      await load();
    } catch (err) {
      handleError(err, 'No se pudo publicar');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className='flex flex-col items-start gap-3 py-4'>
        <p className='text-sm text-destructive'>{error}</p>
        <Button variant='outline' onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (!state || !form) {
    return (
      <div className='flex flex-col gap-4 animate-pulse'>
        <div className='h-8 w-48 rounded bg-muted' />
        <div className='h-4 w-80 rounded bg-muted' />
        <div className='h-72 rounded-xl bg-muted' />
      </div>
    );
  }

  const { published, draft, consoleDraft, bedrockPrompt } = state;
  const consoleDiffers = Boolean(
    consoleDraft &&
    (consoleDraft.instructions !== form.instructions || !sameValue(consoleDraft.model, form.model))
  );

  return (
    <div className='flex flex-col gap-4 pb-8'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-foreground leading-tight'>Agente IA</h1>
          <p className='text-muted-foreground text-sm mt-1'>
            Lo que el agente de WhatsApp sabe del negocio y cómo responde. Los cambios quedan en un
            borrador hasta que los publicas.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {hasDraft && (
            <Button variant='ghost' onClick={() => void handleDiscard()} disabled={busy}>
              Descartar borrador
            </Button>
          )}
          <Button
            variant='outline'
            onClick={() => void handleSave()}
            disabled={busy || !dirty || problems.length > 0}
          >
            Guardar borrador
          </Button>
          <Button
            onClick={() => setPublishOpen(true)}
            disabled={busy || problems.length > 0 || (!differsFromPublished && !dirty)}
          >
            Publicar
          </Button>
        </div>
      </div>

      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <Badge variant='outline' className='border-transparent bg-primary text-primary-foreground'>
          En uso: {published.version}
        </Badge>
        <span className='text-muted-foreground'>
          {published.publishedAt
            ? `Publicada por ${published.publishedBy || '—'} el ${formatDate(published.publishedAt)}`
            : 'Configuración del despliegue (aún no se publica desde la web)'}
        </span>
        {draft && (
          <Badge variant='outline' className='border-warning/25 bg-warning/10 text-warning'>
            Borrador sin publicar · {draft.updatedBy || '—'} · {formatDate(draft.updatedAt)}
          </Badge>
        )}
        {dirty && <span className='text-xs text-warning'>Cambios sin guardar</span>}
        {bedrockPrompt && (
          <a
            href={consoleUrl(bedrockPrompt.arn)}
            target='_blank'
            rel='noreferrer'
            className='ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
            title={`Prompt ${bedrockPrompt.name} (${bedrockPrompt.id})`}
          >
            Bedrock Prompt Management: {bedrockPrompt.name}
            <ExternalLink className='h-3 w-3' />
          </a>
        )}
      </div>

      {consoleDiffers && consoleDraft && (
        <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm'>
          <p>
            Alguien editó el borrador del prompt en la consola de AWS (instrucciones o modelo).
            Puedes traer esos cambios a esta pantalla y revisarlos antes de publicar.
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={() =>
              setForm(current =>
                current
                  ? {
                      ...current,
                      instructions: consoleDraft.instructions,
                      model: consoleDraft.model,
                    }
                  : current
              )
            }
          >
            Traer cambios de AWS
          </Button>
        </div>
      )}

      {!state.liveMatches && (
        <div className='flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-foreground'>
          <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-warning' />
          <p>
            La configuración que usa el agente no coincide con la última versión publicada aquí:
            probablemente un despliegue la cambió. Publica de nuevo para volver a esta.
          </p>
        </div>
      )}

      <div className='flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4'>
        <div>
          <p className='text-sm font-medium text-foreground'>
            Agente activo en todos los chats de WhatsApp
          </p>
          <p className='text-xs text-muted-foreground'>
            Encendido: el agente de IA contesta solo cada mensaje que llega. Apagado: no contesta a
            nadie; los mensajes llegan a la bandeja de WhatsApp como no leídos y una persona del
            equipo responde desde ahí. El cambio se aplica al publicar.
          </p>
          <p className='text-xs text-muted-foreground'>
            Para pausar el agente en una sola conversación, usa el botón dentro de esa conversación
            en la bandeja.
          </p>
        </div>
        <Switch checked={form.enabled} onCheckedChange={checked => update('enabled', checked)} />
      </div>

      <div className='flex gap-1 border-b border-border'>
        {TABS.map(item => (
          <button
            key={item.id}
            type='button'
            onClick={() => setTab(item.id)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px',
              tab === item.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <item.icon className='h-4 w-4' />
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'instructions' && (
        <div className='grid gap-4 lg:grid-cols-[1fr_320px]'>
          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='agent-business'>Nombre del negocio</Label>
              <Input
                id='agent-business'
                value={form.businessName}
                maxLength={LIMITS.businessName}
                onChange={e => update('businessName', e.target.value)}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <div className='flex items-baseline justify-between'>
                <Label htmlFor='agent-instructions'>Instrucciones del negocio</Label>
                <span
                  className={cn(
                    'text-xs',
                    form.instructions.length > LIMITS.instructions
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  )}
                >
                  {form.instructions.length.toLocaleString('es-CL')} /{' '}
                  {LIMITS.instructions.toLocaleString('es-CL')}
                </span>
              </div>
              <Textarea
                id='agent-instructions'
                value={form.instructions}
                onChange={e => update('instructions', e.target.value)}
                className='min-h-[420px] font-mono text-[13px] leading-relaxed'
              />
            </div>
          </div>
          <aside className='flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm h-fit'>
            <p className='font-medium text-foreground'>Cómo escribirlas</p>
            <ol className='flex list-decimal flex-col gap-2 pl-4 text-muted-foreground'>
              <li>
                <span className='text-foreground'>Quién es y con quién habla:</span> rol y público.
              </li>
              <li>
                <span className='text-foreground'>Qué significan los datos:</span> estados, atrasos,
                términos del negocio.
              </li>
              <li>
                <span className='text-foreground'>Cómo responder:</span> nivel de detalle, formato
                de fechas, tono.
              </li>
              <li>
                <span className='text-foreground'>Qué hacer en cada caso:</span> reglas «si pasa X,
                haz Y».
              </li>
            </ol>
            <p className='text-muted-foreground'>
              No escribas datos que cambian (estados, posiciones): el agente los consulta en cada
              pregunta. Las reglas de seguridad son fijas y siempre se aplican.
            </p>
          </aside>
        </div>
      )}

      {tab === 'messages' && (
        <div className='grid gap-4 max-w-3xl'>
          {(
            [
              ['greeting', 'Saludo', 'Cuando alguien escribe por primera vez o saluda.'],
              ['refusal', 'Mensaje fuera de tema', 'Cuando preguntan algo que no es del negocio.'],
              [
                'handoffMessage',
                'Mensaje de derivación',
                'Cuando el agente pasa la conversación a una persona.',
              ],
            ] as const
          ).map(([key, label, hint]) => (
            <div key={key} className='flex flex-col gap-1.5'>
              <Label htmlFor={`agent-${key}`}>{label}</Label>
              <p className='text-xs text-muted-foreground -mt-1'>{hint}</p>
              <Textarea
                id={`agent-${key}`}
                value={form[key]}
                maxLength={LIMITS.message}
                onChange={e => update(key, e.target.value)}
                className='min-h-[90px]'
              />
            </div>
          ))}
        </div>
      )}

      {tab === 'parameters' && (
        <ParametersPanel
          instructions={form.instructions}
          parameters={form.parameters}
          onChange={parameters => update('parameters', parameters)}
        />
      )}

      {tab === 'model' && (
        <ModelPanel model={form.model} onChange={model => update('model', model)} />
      )}

      {tab === 'history' && (
        <VersionHistory current={published.version} onRestored={load} onError={handleError} />
      )}

      {problems.length > 0 && tab !== 'history' && (
        <ul className='list-disc pl-5 text-xs text-warning'>
          {problems.map(problem => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publicar la configuración</DialogTitle>
          </DialogHeader>
          <div className='flex flex-col gap-2 py-2'>
            <p className='text-sm text-muted-foreground'>
              Se crea una versión nueva del prompt en Bedrock y el agente la usará en menos de un
              minuto. La versión actual ({published.version}) queda en el historial y puedes volver
              a ella.
            </p>
            {form.model.id !== published.config.model.id && (
              <p className='text-sm text-warning'>
                Cambia el modelo a {form.model.id}. Se comprueba que esté habilitado antes de
                publicar.
              </p>
            )}
            {form.enabled !== published.config.enabled && (
              <p className='text-sm text-warning'>
                {form.enabled ? 'Esto enciende el agente.' : 'Esto apaga el agente.'}
              </p>
            )}
            <Label htmlFor='agent-comment' className='mt-2'>
              Qué cambió (opcional)
            </Label>
            <Input
              id='agent-comment'
              value={comment}
              maxLength={300}
              onChange={e => setComment(e.target.value)}
              placeholder='Ej.: más detalle en los viajes marítimos'
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setPublishOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => void handlePublish()} disabled={busy}>
              Publicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default AgentConfigPage;
