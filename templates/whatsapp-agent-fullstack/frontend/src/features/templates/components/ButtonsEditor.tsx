import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  BUTTON_KINDS,
  BUTTON_TYPE_LABEL,
  BUTTON_TYPE_MAX,
  TEMPLATE_LIMITS as L,
  type ButtonKind,
} from '../templateRules';
import { variableToken } from '../templateStatus';
import type { DraftButton } from '../validateTemplate';

let counter = 0;
const newButton = (type: ButtonKind): DraftButton => ({
  id: `btn-${Date.now()}-${++counter}`,
  type,
  text: '',
  url: '',
  phone: '',
  code: '',
});

/**
 * Where a new button goes: next to the others of its kind (quick replies, or
 * the rest), so adding never interleaves them. Reordering by hand still can,
 * and the validator says so.
 */
function insertGrouped(list: DraftButton[], button: DraftButton): DraftButton[] {
  const isQuick = (item: DraftButton) => item.type === 'QUICK_REPLY';
  let lastSame = -1;
  list.forEach((item, index) => {
    if (isQuick(item) === isQuick(button)) lastSame = index;
  });
  if (lastSame === -1) return [...list, button];
  return [...list.slice(0, lastSame + 1), button, ...list.slice(lastSame + 1)];
}

/** `value/max`, in the error ink once it is over. */
export function Counter({ value, max, id }: { value: number; max: number; id?: string }) {
  return (
    <span
      id={id}
      className={cn(
        'text-xs tabular-nums',
        value > max ? 'font-semibold text-destructive-strong' : 'text-foreground-secondary'
      )}
    >
      {value}/{max}
      {value > max ? ' · excede el máximo' : ''}
    </span>
  );
}

interface ButtonsEditorProps {
  buttons: DraftButton[];
  onChange: (buttons: DraftButton[]) => void;
}

export function ButtonsEditor({ buttons, onChange }: ButtonsEditorProps) {
  const full = buttons.length >= L.buttonsMax;
  const countOf = (kind: ButtonKind) => buttons.filter(button => button.type === kind).length;
  const update = (id: string, patch: Partial<DraftButton>) =>
    onChange(buttons.map(button => (button.id === id ? { ...button, ...patch } : button)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...buttons];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    onChange(next);
  };

  return (
    <div className='flex flex-col gap-3'>
      {buttons.length === 0 ? (
        <p className='text-sm text-foreground-secondary'>Sin botones.</p>
      ) : (
        <ol className='flex flex-col gap-3'>
          {buttons.map((button, index) => {
            const base = `button-${button.id}`;
            return (
              <li key={button.id} className='rounded-xl border border-border bg-background p-3'>
                <div className='flex items-center justify-between gap-2'>
                  <p className='text-sm font-semibold text-foreground'>
                    {index + 1}. {BUTTON_TYPE_LABEL[button.type]}
                  </p>
                  <div className='flex items-center gap-1'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='h-9 w-9'
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Subir el botón ${index + 1}`}
                    >
                      <ArrowUp className='h-4 w-4' aria-hidden />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='h-9 w-9'
                      disabled={index === buttons.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Bajar el botón ${index + 1}`}
                    >
                      <ArrowDown className='h-4 w-4' aria-hidden />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='h-9 w-9 text-destructive-strong'
                      onClick={() => onChange(buttons.filter(item => item.id !== button.id))}
                      aria-label={`Quitar el botón ${index + 1}`}
                    >
                      <Trash2 className='h-4 w-4' aria-hidden />
                    </Button>
                  </div>
                </div>

                <div className='mt-2 grid gap-3 sm:grid-cols-2'>
                  <div className='flex flex-col gap-1.5'>
                    <div className='flex items-baseline justify-between gap-2'>
                      <Label htmlFor={`${base}-text`}>Texto del botón</Label>
                      <Counter
                        id={`${base}-text-count`}
                        value={button.text.length}
                        max={L.buttonTextMax}
                      />
                    </div>
                    <Input
                      id={`${base}-text`}
                      value={button.text}
                      onChange={event => update(button.id, { text: event.target.value })}
                      aria-describedby={`${base}-text-count`}
                      aria-invalid={button.text.length > L.buttonTextMax}
                    />
                  </div>

                  {button.type === 'URL' ? (
                    <div className='flex flex-col gap-1.5'>
                      <div className='flex items-baseline justify-between gap-2'>
                        <Label htmlFor={`${base}-url`}>URL</Label>
                        <Counter value={button.url.length} max={L.urlMax} />
                      </div>
                      <Input
                        id={`${base}-url`}
                        type='url'
                        inputMode='url'
                        placeholder='https://'
                        value={button.url}
                        onChange={event => update(button.id, { url: event.target.value })}
                        aria-describedby={`${base}-url-hint`}
                      />
                      <p id={`${base}-url-hint`} className='text-xs text-foreground-secondary'>
                        Opcional: una variable al final, {variableToken('1')}.{' '}
                        {/* The token is appended, never typed: easier than braces on a phone. */}
                        <button
                          type='button'
                          className='font-medium text-secondary underline underline-offset-2 disabled:no-underline disabled:opacity-60'
                          disabled={button.url.includes(variableToken('1'))}
                          onClick={() =>
                            update(button.id, { url: button.url + variableToken('1') })
                          }
                        >
                          Agregar variable
                        </button>
                      </p>
                    </div>
                  ) : null}

                  {button.type === 'PHONE_NUMBER' ? (
                    <div className='flex flex-col gap-1.5'>
                      <div className='flex items-baseline justify-between gap-2'>
                        <Label htmlFor={`${base}-phone`}>Teléfono</Label>
                        <Counter value={button.phone.length} max={L.phoneMax} />
                      </div>
                      <Input
                        id={`${base}-phone`}
                        type='tel'
                        inputMode='tel'
                        placeholder='+56912345678'
                        value={button.phone}
                        onChange={event => update(button.id, { phone: event.target.value })}
                        aria-describedby={`${base}-phone-hint`}
                      />
                      <p id={`${base}-phone-hint`} className='text-xs text-foreground-secondary'>
                        Con código de país, sin espacios.
                      </p>
                    </div>
                  ) : null}

                  {button.type === 'COPY_CODE' ? (
                    <div className='flex flex-col gap-1.5'>
                      <div className='flex items-baseline justify-between gap-2'>
                        <Label htmlFor={`${base}-code`}>Código de ejemplo</Label>
                        <Counter value={button.code.length} max={L.copyCodeExampleMax} />
                      </div>
                      <Input
                        id={`${base}-code`}
                        value={button.code}
                        onChange={event => update(button.id, { code: event.target.value })}
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className='flex flex-wrap items-center gap-3'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type='button' variant='outline' disabled={full}>
              <Plus className='h-4 w-4' aria-hidden />
              Agregar botón
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='start'>
            {BUTTON_KINDS.map(kind => {
              const used = countOf(kind);
              return (
                <DropdownMenuItem
                  key={kind}
                  disabled={used >= BUTTON_TYPE_MAX[kind]}
                  onSelect={() => onChange(insertGrouped(buttons, newButton(kind)))}
                >
                  {BUTTON_TYPE_LABEL[kind]}
                  <span className='ml-auto pl-4 text-xs tabular-nums text-foreground-secondary'>
                    {used}/{BUTTON_TYPE_MAX[kind]}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className='text-xs text-foreground-secondary'>
          {buttons.length}/{L.buttonsMax} botones. Las respuestas rápidas van juntas.
        </span>
      </div>
    </div>
  );
}
