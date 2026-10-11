import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';

// Os estilos vivem em index.css (tokens + classes .btn, .field, .badge, .card…).
const button = cva('btn', {
  variants: {
    variant: { default: 'btn-default', outline: 'btn-outline', ghost: 'btn-ghost', danger: 'btn-danger' },
  },
  defaultVariants: { variant: 'default' },
});

export function Button({ className, variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button className={cn(button({ variant }), className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('field', className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('field', className)} {...props} />;
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-[var(--secondary)]">
      {children}
    </label>
  );
}

/** Cartão elevado com cantos generosos. */
export function Card({ className, pad = true, ...props }: HTMLAttributes<HTMLDivElement> & { pad?: boolean }) {
  return <div className={cn('card', pad && 'card-pad', className)} {...props} />;
}

export type Tone = 'gray' | 'blue' | 'green' | 'orange' | 'red';

export function Badge({ tone = 'gray', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn('badge', `badge-${tone}`, className)} {...props} />;
}

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'gray', IN_REVIEW: 'orange', PENDING_APPROVAL: 'orange', APPROVED: 'green', SENT: 'blue',
  ACCEPTED: 'green', REJECTED: 'red', EXPIRED: 'gray', CANCELLED: 'gray',
  LOCKED: 'blue', ACTIVE: 'green', REVOKED: 'red', USED: 'green',
};

/** Etiqueta de estado da proposta (cor segundo o estado). */
export function StatusBadge({ status, ...props }: HTMLAttributes<HTMLSpanElement> & { status: string }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status] ?? 'gray'} {...props}>{t(`status.${status}`)}</Badge>;
}

export function toneFor(status: string): Tone {
  return STATUS_TONE[status] ?? 'gray';
}

/** Cabeçalho de página: título grande, subtítulo opcional e ações à direita. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-tight sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-[var(--secondary)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Controlo segmentado (estilo UISegmentedControl) com semântica de separadores. */
export function SegmentedControl<T extends string>({ items, value, onChange }: { items: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="segmented">
      {items.map((i) => (
        <button key={i.value} type="button" role="tab" aria-selected={value === i.value} onClick={() => onChange(i.value)}>{i.label}</button>
      ))}
    </div>
  );
}

/** Pequeno título de secção sobre uma lista agrupada. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 px-1 text-lg font-semibold">{children}</h2>;
}

/** Estado vazio / mensagem discreta. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[var(--radius-lg)] bg-[var(--fill)] px-4 py-6 text-center text-sm text-[var(--secondary)]">{children}</p>;
}
