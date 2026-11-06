import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { fetchModels } from '../agentConfigService';
import type { AgentModel, ModelOption } from '../types';

interface ModelPanelProps {
  model: AgentModel;
  onChange: (model: AgentModel) => void;
}

/**
 * The model and its inference parameters: what Bedrock Prompt Management keeps
 * in the prompt's variant, the same fields as the console's prompt builder.
 */
export function ModelPanel({ model, onChange }: ModelPanelProps) {
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    let active = true;
    fetchModels()
      .then(list => {
        if (active) setModels(list);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const options = models.some(option => option.id === model.id)
    ? models
    : [{ id: model.id, name: model.id }, ...models];
  const set = (changes: Partial<AgentModel>) => onChange({ ...model, ...changes });

  return (
    <div className='grid max-w-3xl gap-5'>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='agent-model'>Modelo</Label>
        <p className='-mt-1 text-xs text-muted-foreground'>
          Los modelos Claude disponibles en la cuenta de AWS. Al publicar se comprueba que el modelo
          esté habilitado.
        </p>
        <select
          id='agent-model'
          value={model.id}
          onChange={e => set({ id: e.target.value })}
          className='h-10 rounded-md border border-input bg-background px-3 text-sm'
        >
          {options.map(option => (
            <option key={option.id} value={option.id}>
              {option.name ? `${option.name} · ${option.id}` : option.id}
            </option>
          ))}
        </select>
      </div>

      <div className='flex flex-col gap-1.5'>
        <div className='flex items-baseline justify-between'>
          <Label htmlFor='agent-temperature'>Temperatura</Label>
          <span className='text-sm tabular-nums text-foreground'>
            {model.temperature.toFixed(2)}
          </span>
        </div>
        <p className='-mt-1 text-xs text-muted-foreground'>
          Más baja, respuestas más precisas y repetibles (recomendado para datos de la operación).
          Más alta, más variadas.
        </p>
        <input
          id='agent-temperature'
          type='range'
          min={0}
          max={1}
          step={0.05}
          value={model.temperature}
          onChange={e => set({ temperature: Number(e.target.value) })}
          className='accent-primary'
        />
      </div>

      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='agent-max-tokens'>Largo máximo de la respuesta (tokens)</Label>
        <p className='-mt-1 text-xs text-muted-foreground'>
          Entre 256 y 8.192. Unos 4.000 tokens alcanzan para el detalle completo de varios viajes;
          las respuestas largas se envían en varios mensajes de WhatsApp.
        </p>
        <Input
          id='agent-max-tokens'
          type='number'
          min={256}
          max={8192}
          step={256}
          value={model.maxTokens}
          onChange={e => set({ maxTokens: Number(e.target.value) })}
          className='max-w-40'
        />
      </div>

      <div className='flex flex-col gap-2 rounded-xl border border-border p-4'>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <p className='text-sm font-medium text-foreground'>Top P (avanzado)</p>
            <p className='text-xs text-muted-foreground'>
              Otra forma de controlar la variedad. Anthropic recomienda ajustar la temperatura o el
              Top P, no ambos; déjalo apagado si no lo necesitas.
            </p>
          </div>
          <Switch
            checked={model.topP !== null}
            onCheckedChange={checked => set({ topP: checked ? 0.9 : null })}
          />
        </div>
        {model.topP !== null && (
          <Input
            aria-label='Top P'
            type='number'
            min={0.05}
            max={1}
            step={0.05}
            value={model.topP}
            onChange={e => set({ topP: Number(e.target.value) })}
            className='max-w-40'
          />
        )}
      </div>
    </div>
  );
}
