// Aus der Mottulbox übernommen (project_mega/src/renderer/src/components/ui/alert.tsx, Stand 0cc14cb).
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export type AlertTone = 'success' | 'warning' | 'danger'

const TONE: Record<AlertTone, string> = {
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-danger/40 bg-danger/10 text-danger'
}

/**
 * Hinweis im Inhalt (bleibt stehen, anders als ein Toast): getönte Box in der Statusfarbe.
 * Ohne `title` eine kurze Zeile; mit `title` (und meist `icon`) eine Karte, deren Erklärung in
 * ruhiger Schrift darunter steht. Eine Stelle für Farbe und Tönung – sonst driftet sie je Kopie.
 */
export function Alert({
  tone,
  title,
  icon: Icon,
  className,
  children
}: {
  tone: AlertTone
  title?: ReactNode
  icon?: LucideIcon
  className?: string
  children?: ReactNode
}): JSX.Element {
  if (title == null) {
    return (
      <p
        role="status"
        className={cn('rounded-md border px-3 py-2 text-xs font-medium', TONE[tone], className)}
      >
        {children}
      </p>
    )
  }
  return (
    <div
      role="status"
      className={cn('flex items-start gap-3 rounded-lg border p-4', TONE[tone], className)}
    >
      {Icon && <Icon className="mt-0.5 size-5 shrink-0" />}
      <div className="text-sm">
        <p className="font-medium">{title}</p>
        {children != null && <div className="mt-1 text-muted-foreground">{children}</div>}
      </div>
    </div>
  )
}
