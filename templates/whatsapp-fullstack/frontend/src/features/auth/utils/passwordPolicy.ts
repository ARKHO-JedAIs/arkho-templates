/**
 * Mirrors the Cognito user pool's password policy exactly (see
 * `passwordPolicy` in the backend's lib/stack/cognito/index.ts: min 8 chars,
 * upper + lower + digits, symbols not required). Validating here just saves a
 * round-trip and turns Cognito's generic "Password did not conform with
 * policy" into a list of what's actually missing - Cognito remains the
 * authority.
 */
export interface PasswordRule {
  label: string;
  isMet: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { label: 'Al menos 8 caracteres', isMet: p => p.length >= 8 },
  { label: 'Una letra mayúscula', isMet: p => /[A-Z]/.test(p) },
  { label: 'Una letra minúscula', isMet: p => /[a-z]/.test(p) },
  { label: 'Un número', isMet: p => /\d/.test(p) },
];

export function isPasswordValid(password: string): boolean {
  return PASSWORD_RULES.every(rule => rule.isMet(password));
}
