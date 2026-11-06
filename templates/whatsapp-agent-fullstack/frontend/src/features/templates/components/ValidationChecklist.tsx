import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import type { RuleResult } from '../validateTemplate';

/** One rule: an icon and a word for its state, never the colour alone. */
function RuleItem({ result }: { result: RuleResult }) {
  const [Icon, tone, state] = result.ok
    ? [CircleCheck, 'text-success-strong', 'Cumple']
    : result.level === 'error'
      ? [CircleX, 'text-destructive-strong', 'No cumple']
      : [TriangleAlert, 'text-warning-strong', 'Recomendación no cumplida'];
  return (
    <li className='flex items-start gap-2'>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-hidden />
      <span className='text-sm text-foreground'>
        <span className='sr-only'>{state}: </span>
        {result.label}
        {result.detail ? (
          <span className='mt-0.5 block text-xs text-foreground-secondary'>{result.detail}</span>
        ) : null}
      </span>
    </li>
  );
}

/** Every rule that applies to the draft, requirements first, then Meta's recommendations. */
export function ValidationChecklist({ results }: { results: readonly RuleResult[] }) {
  const requirements = results.filter(result => result.level === 'error');
  const recommendations = results.filter(result => result.level === 'warning');
  const failing = requirements.filter(result => !result.ok).length;
  return (
    <section
      aria-labelledby='template-checklist-title'
      className='rounded-2xl border border-border bg-card p-4'
    >
      <h2 id='template-checklist-title' className='font-semibold text-foreground'>
        Validación
      </h2>
      <p className='mt-0.5 text-xs text-foreground-secondary' aria-live='polite'>
        {failing === 0
          ? 'Cumple todos los requisitos.'
          : `${failing} ${failing === 1 ? 'requisito pendiente' : 'requisitos pendientes'}.`}
      </p>
      <h3 className='mt-3 text-xs font-semibold uppercase tracking-wide text-foreground-secondary'>
        Requisitos
      </h3>
      <ul className='mt-1.5 flex flex-col gap-2'>
        {requirements.map(result => (
          <RuleItem key={result.id} result={result} />
        ))}
      </ul>
      {recommendations.length > 0 ? (
        <>
          <h3 className='mt-4 text-xs font-semibold uppercase tracking-wide text-foreground-secondary'>
            Recomendaciones de Meta
          </h3>
          <p className='text-xs text-foreground-secondary'>
            No impiden enviarla, pero pueden causar rechazo.
          </p>
          <ul className='mt-1.5 flex flex-col gap-2'>
            {recommendations.map(result => (
              <RuleItem key={result.id} result={result} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
