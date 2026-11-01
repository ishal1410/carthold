import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "approve" | "reject" | "ghost" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "group relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium " +
  "transition-[transform,background-color,color,box-shadow,border-color,filter] duration-[var(--duration-fast)] ease-snap " +
  "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hold";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-hold text-hold-ink shadow-raise hover:brightness-110",
  approve: "bg-paid text-paid-ink shadow-raise hover:brightness-110",
  reject: "border border-blocked/50 bg-blocked-soft text-blocked hover:border-blocked hover:bg-blocked/20",
  ghost: "border border-line-strong text-ink hover:border-ink-faint hover:bg-surface-3",
  subtle: "text-ink-muted hover:bg-surface-3 hover:text-ink",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

// With a trailing icon the right padding shrinks so the icon circle sits flush.
const iconPad: Record<ButtonSize, string> = { sm: "pr-1", md: "pr-1.5", lg: "pr-2" };
const iconWell: Record<ButtonSize, string> = { sm: "size-6", md: "size-7", lg: "size-8" };

const wellTone: Record<ButtonVariant, string> = {
  primary: "bg-hold-ink/10",
  approve: "bg-paid-ink/10",
  reject: "bg-blocked/15",
  ghost: "bg-surface-3",
  subtle: "bg-surface-3",
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  withIcon?: boolean;
  className?: string;
}

/** Button classes, for styling a Next Link or <a> like a Button. */
export function buttonClasses({
  variant = "primary",
  size = "md",
  withIcon = false,
  className,
}: ButtonStyleOptions = {}): string {
  return cx(base, variants[variant], sizes[size], withIcon && iconPad[size], className);
}

/** Trailing icon in its own circle; nudges up-right when the parent .group hovers. */
export function ButtonIcon({
  children,
  variant = "primary",
  size = "md",
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex items-center justify-center rounded-pill transition-transform duration-[var(--duration-base)] ease-snap",
        "group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105 [&>svg]:size-4",
        iconWell[size],
        wellTone[variant],
      )}
    >
      {children}
    </span>
  );
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Trailing icon, rendered inside a nested circle. */
  icon?: ReactNode;
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, withIcon: Boolean(icon), className })}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden
          className="size-3.5 shrink-0 animate-spin rounded-pill border-2 border-current border-r-transparent motion-reduce:animate-none"
        />
      )}
      <span>{children}</span>
      {icon && (
        <ButtonIcon variant={variant} size={size}>
          {icon}
        </ButtonIcon>
      )}
    </button>
  );
}
