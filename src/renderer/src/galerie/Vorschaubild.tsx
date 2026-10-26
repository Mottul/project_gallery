// Vorschaubild über thumb:// (Kennung, nie Pfad) mit Platzhalter in der Durchschnittsfarbe; ein
// defektes Bild zeigt ein Symbol, eine fehlende Vorschau (204) bleibt beim Platzhalter.
import { ImageOff } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@renderer/lib/utils'
import type { ImageInfo } from '@shared/types'
import { thumbUrl, type Stufe } from '@shared/vorschau'

/** Nur eine echte Farbe „#rrggbb“ gelangt ins CSS (Review-Checkliste, „Fremde Eingaben“). */
const FARBE = /^#[0-9a-f]{6}$/i

/** Stufe für eine Anzeigegröße in CSS-Pixeln (scharf auch auf hochauflösenden Bildschirmen). */
export function stufeFuer(px: number): Stufe {
  return px * (window.devicePixelRatio || 1) > 256 ? 768 : 256
}

export function Vorschaubild({
  bild,
  stufe = 256,
  passend = 'contain',
  groesse,
  className
}: {
  bild: ImageInfo | undefined
  stufe?: Stufe
  /** cover = quadratisch beschnitten, contain = ganzes Bild */
  passend?: 'cover' | 'contain'
  /** Kantenlänge in px (quadratisch); ohne = Größe aus `className` */
  groesse?: number
  className?: string
}): JSX.Element {
  const [fehlt, setFehlt] = useState(false)
  const farbe = bild?.color && FARBE.test(bild.color) ? bild.color : undefined
  return (
    <span
      className={cn('flex items-center justify-center overflow-hidden bg-muted', className)}
      style={{
        ...(farbe ? { backgroundColor: farbe } : {}),
        ...(groesse ? { width: groesse, height: groesse } : {})
      }}
    >
      {bild &&
        (bild.status === 'defekt' ? (
          <ImageOff className="size-5 text-muted-foreground" aria-label="Bild defekt" />
        ) : (
          !fehlt && (
            <img
              src={thumbUrl(bild.id, stufe, bild.mtime)}
              alt=""
              decoding="async"
              draggable={false}
              className={cn('size-full', passend === 'cover' ? 'object-cover' : 'object-contain')}
              onError={() => setFehlt(true)}
            />
          )
        ))}
    </span>
  )
}
