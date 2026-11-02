import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { avatarTone, initials } from '../services/mappers';

// Spelled out in full so Tailwind finds every class; one pair per --avatar-N token.
const TONES = [
  'bg-avatar-1 text-avatar-1-foreground',
  'bg-avatar-2 text-avatar-2-foreground',
  'bg-avatar-3 text-avatar-3-foreground',
  'bg-avatar-4 text-avatar-4-foreground',
  'bg-avatar-5 text-avatar-5-foreground',
];

interface ContactAvatarProps {
  name: string;
  phone: string;
  className?: string;
}

/** A contact's initials on a soft tint that is always the same for the same phone. */
export function ContactAvatar({ name, phone, className }: ContactAvatarProps) {
  return (
    <Avatar className={cn('size-10', className)} aria-hidden>
      <AvatarFallback className={cn('text-sm font-bold', TONES[avatarTone(phone)])}>
        {initials(name, phone)}
      </AvatarFallback>
    </Avatar>
  );
}
