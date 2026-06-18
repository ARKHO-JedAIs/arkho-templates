import type { ReactNode } from "react";
import { Input, type InputProps } from "@/components/atoms/input";
import { Label } from "@/components/atoms/label";

interface FormFieldProps extends InputProps {
  id: string;
  label: string;
  error?: ReactNode;
}

// Molecule: a labelled input with an optional error message, composed from atoms.
export function FormField({ id, label, error, ...inputProps }: FormFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={error ? true : undefined} {...inputProps} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
