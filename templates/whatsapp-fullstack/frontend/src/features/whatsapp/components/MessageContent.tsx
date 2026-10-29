import { useState } from 'react';
import {
  AlertCircle,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  ImageOff,
  Loader2,
  MapPin,
  MousePointerClick,
  ShoppingCart,
  UserRound,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatBytes, mapsUrl } from '../services/mappers';
import type {
  ChatMessage,
  ContactCard,
  FlowReply,
  LocationPayload,
  MediaKind,
  MessageMedia,
  OrderPayload,
  ReplyPayload,
} from '../types';
import { formatMessage } from './formatMessage';

const card = 'flex flex-col gap-1 rounded-xl border border-border/70 bg-background/60 px-3 py-2';

interface MediaViewProps {
  kind: MediaKind;
  media: MessageMedia;
  /**
   * The URL failed: asks for fresh ones (they expire). Returns false when a
   * refresh was already asked for this message, so the error is shown instead
   * of asking forever.
   */
  onExpired?: () => boolean;
}

/** Remount it with `key={media.url}`: a new URL starts over from loading. */
export function MediaView({ kind, media, onExpired }: MediaViewProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'refreshing' | 'error'>('loading');
  const [open, setOpen] = useState(false);

  const fail = () => setState(onExpired?.() ? 'refreshing' : 'error');
  const ready = () => setState('ready');

  if (!media.url) {
    return (
      <p className='flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-foreground-secondary'>
        <ImageOff className='h-4 w-4 shrink-0' aria-hidden />
        {media.error === 'download_failed'
          ? 'No se pudo descargar el archivo de WhatsApp.'
          : 'El archivo no está disponible.'}
      </p>
    );
  }

  if (state === 'error' || state === 'refreshing') {
    return (
      <p className='flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs text-foreground-secondary'>
        {state === 'refreshing' ? (
          <Loader2 className='h-4 w-4 shrink-0 animate-spin' aria-hidden />
        ) : (
          <AlertCircle className='h-4 w-4 shrink-0' aria-hidden />
        )}
        {state === 'refreshing'
          ? 'Actualizando el enlace del archivo…'
          : 'No se pudo cargar el archivo.'}
      </p>
    );
  }

  if (kind === 'image' || kind === 'sticker') {
    const alt = media.caption || (kind === 'sticker' ? 'Sticker' : 'Imagen recibida');
    const image = (
      <img
        src={media.url}
        alt={alt}
        onLoad={ready}
        onError={fail}
        className={cn(
          'block object-cover',
          kind === 'sticker' ? 'h-32 w-32 object-contain' : 'max-h-72 w-full rounded-xl',
          state === 'loading' && 'opacity-0'
        )}
      />
    );
    return (
      <div className={cn('relative', state === 'loading' && 'min-h-24 min-w-24')}>
        {state === 'loading' ? (
          <span className='absolute inset-0 flex items-center justify-center rounded-xl bg-muted'>
            <Loader2 className='h-5 w-5 animate-spin text-foreground-secondary' aria-hidden />
            <span className='sr-only'>Cargando imagen…</span>
          </span>
        ) : null}
        {kind === 'sticker' ? (
          image
        ) : (
          <>
            <button
              type='button'
              onClick={() => setOpen(true)}
              className='block w-full overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              aria-label='Ver la imagen en tamaño completo'
            >
              {image}
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent className='max-w-3xl'>
                <DialogHeader>
                  <DialogTitle>Imagen</DialogTitle>
                  <DialogDescription>
                    {media.caption || 'Imagen de la conversación'}
                  </DialogDescription>
                </DialogHeader>
                <img
                  src={media.url}
                  alt={alt}
                  className='max-h-[75vh] w-full rounded-lg object-contain'
                />
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <audio
        controls
        preload='metadata'
        src={media.url}
        onLoadedMetadata={ready}
        onError={fail}
        className='w-64 max-w-full'
        aria-label={media.voice ? 'Nota de voz' : 'Audio'}
      >
        <track kind='captions' />
      </audio>
    );
  }

  if (kind === 'video') {
    return (
      <video
        controls
        preload='metadata'
        src={media.url}
        onLoadedMetadata={ready}
        onError={fail}
        className='max-h-72 w-full rounded-xl bg-muted'
      >
        <track kind='captions' />
      </video>
    );
  }

  const name = media.filename || 'Documento';
  return (
    <div className={cn(card, 'flex-row items-center gap-3')}>
      <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary'>
        <FileText className='h-5 w-5' aria-hidden />
      </span>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-semibold text-foreground'>{name}</p>
        <p className='text-xs text-foreground-secondary'>
          {[media.mimeType.split('/').pop()?.toUpperCase(), formatBytes(media.size)]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <a
        href={media.url}
        download={name}
        target='_blank'
        rel='noreferrer'
        className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground-secondary hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        aria-label={`Descargar ${name}`}
        title='Descargar'
      >
        <Download className='h-4 w-4' aria-hidden />
      </a>
    </div>
  );
}

export function LocationCard({ location }: { location: LocationPayload }) {
  return (
    <div className={card}>
      <p className='flex items-center gap-1.5 text-sm font-semibold text-foreground'>
        <MapPin className='h-4 w-4 shrink-0 text-destructive' aria-hidden />
        {location.name || 'Ubicación compartida'}
      </p>
      {location.address ? (
        <p className='text-xs text-foreground-secondary'>{location.address}</p>
      ) : null}
      <p className='text-xs text-foreground-secondary'>
        {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
      </p>
      <a
        href={mapsUrl(location)}
        target='_blank'
        rel='noreferrer'
        className='mt-1 flex w-fit items-center gap-1 text-xs font-semibold text-primary underline-offset-2 hover:underline'
      >
        Abrir en Google Maps
        <ExternalLink className='h-3 w-3' aria-hidden />
      </a>
    </div>
  );
}

export function ContactCards({ contacts }: { contacts: ContactCard[] }) {
  if (contacts.length === 0) {
    return <p className='text-xs text-foreground-secondary'>Contacto sin datos.</p>;
  }
  return (
    <div className='flex flex-col gap-1.5'>
      {contacts.map((contact, index) => (
        <div key={`${contact.name}-${index}`} className={cn(card, 'flex-row items-start gap-2.5')}>
          <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground-secondary'>
            <UserRound className='h-4 w-4' aria-hidden />
          </span>
          <div className='min-w-0'>
            <p className='truncate text-sm font-semibold text-foreground'>
              {contact.name || 'Sin nombre'}
            </p>
            {contact.org ? (
              <p className='text-xs text-foreground-secondary'>{contact.org}</p>
            ) : null}
            {contact.phones.map(phone => (
              <a
                key={phone}
                href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                className='block text-xs text-primary underline-offset-2 hover:underline'
              >
                {phone}
              </a>
            ))}
            {contact.emails.map(email => (
              <a
                key={email}
                href={`mailto:${email}`}
                className='block text-xs text-primary underline-offset-2 hover:underline'
              >
                {email}
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const REPLY_LABEL = {
  button_reply: 'Respuesta a botón',
  list_reply: 'Respuesta a lista',
  button: 'Respuesta a botón',
} as const;

export function ReplyView({
  kind,
  reply,
}: {
  kind: keyof typeof REPLY_LABEL;
  reply: ReplyPayload;
}) {
  return (
    <div className='flex flex-col gap-0.5'>
      <span className='flex items-center gap-1 text-[11px] font-semibold text-foreground-secondary'>
        <MousePointerClick className='h-3 w-3' aria-hidden />
        {REPLY_LABEL[kind]}
      </span>
      <p className='whitespace-pre-wrap break-words'>{formatMessage(reply.title)}</p>
      {reply.description ? (
        <p className='text-xs text-foreground-secondary'>{reply.description}</p>
      ) : null}
    </div>
  );
}

export function FlowCard({ flow }: { flow: FlowReply }) {
  return (
    <div className={card}>
      <p className='flex items-center gap-1.5 text-[11px] font-semibold text-foreground-secondary'>
        <ClipboardList className='h-3.5 w-3.5' aria-hidden />
        Formulario respondido
      </p>
      {flow.fields.length > 0 ? (
        <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs'>
          {flow.fields.map(field => (
            <div key={field.key} className='contents'>
              <dt className='font-semibold text-foreground-secondary'>{field.key}</dt>
              <dd className='break-words text-foreground'>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className='text-xs text-foreground-secondary'>Sin campos.</p>
      )}
    </div>
  );
}

export function OrderCard({ order }: { order: OrderPayload }) {
  const money = (price: number | null, currency: string) =>
    price === null
      ? ''
      : currency
        ? new Intl.NumberFormat('es', { style: 'currency', currency }).format(price)
        : String(price);
  return (
    <div className={card}>
      <p className='flex items-center gap-1.5 text-[11px] font-semibold text-foreground-secondary'>
        <ShoppingCart className='h-3.5 w-3.5' aria-hidden />
        Pedido del catálogo
      </p>
      <ul className='text-xs text-foreground'>
        {order.items.map((item, index) => (
          <li key={`${item.id}-${index}`} className='flex justify-between gap-3'>
            <span>
              {item.quantity} × {item.id}
            </span>
            <span className='text-foreground-secondary'>{money(item.price, item.currency)}</span>
          </li>
        ))}
      </ul>
      {order.text ? <p className='text-xs text-foreground-secondary'>{order.text}</p> : null}
    </div>
  );
}

/** The quoted message above a reply: its text when it is loaded. */
export function QuotedBlock({ quoted }: { quoted: ChatMessage | undefined }) {
  const label = quoted ? (quoted.direction === 'in' ? 'Contacto' : 'Tú') : 'Respuesta a un mensaje';
  const textValue = quoted
    ? quoted.media?.caption || quoted.reply?.title || quoted.text || 'Mensaje'
    : 'Mensaje no cargado';
  return (
    <div className='mb-1 rounded-lg border-l-4 border-primary bg-background/60 px-2 py-1'>
      <p className='text-[11px] font-semibold text-primary'>{label}</p>
      <p className='line-clamp-2 text-xs text-foreground-secondary'>{textValue}</p>
    </div>
  );
}
