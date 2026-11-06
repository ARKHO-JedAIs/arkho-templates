import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LIMITS, variablesOf } from '../types';

interface ParametersPanelProps {
  instructions: string;
  parameters: Record<string, string>;
  onChange: (parameters: Record<string, string>) => void;
}

/**
 * The value of each {{variable}} written in the instructions, the same idea as
 * the variables of a Bedrock prompt: change a number here without touching
 * the text. The agent fills them in on every answer.
 */
export function ParametersPanel({ instructions, parameters, onChange }: ParametersPanelProps) {
  const names = variablesOf(instructions);

  return (
    <div className='grid max-w-3xl gap-4'>
      <div className='rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground'>
        <p>
          Escribe una variable en las instrucciones con doble llave, por ejemplo{' '}
          <code className='rounded bg-muted px-1 text-foreground'>{'{{tolerancia_atraso}}'}</code>,
          y dale su valor aquí. Sirve para datos del negocio que cambian de vez en cuando (minutos
          de tolerancia, horarios, nombres) sin editar el texto.
        </p>
        <p className='mt-2'>Nombres con letras, números y guion bajo, empezando por una letra.</p>
      </div>

      {names.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          Las instrucciones no usan variables todavía.
        </p>
      ) : (
        names.map(name => (
          <div key={name} className='flex flex-col gap-1.5'>
            <Label htmlFor={`agent-param-${name}`}>
              <code>{`{{${name}}}`}</code>
            </Label>
            <Input
              id={`agent-param-${name}`}
              value={parameters[name] ?? ''}
              maxLength={LIMITS.parameter}
              onChange={e => onChange({ ...parameters, [name]: e.target.value })}
              placeholder='Valor'
            />
          </div>
        ))
      )}
    </div>
  );
}
