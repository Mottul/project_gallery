// Farben nur über diese Tokens (CLAUDE.md, „Erscheinungsbild“). Die Werte stehen als CSS-Variablen
// in src/renderer/src/assets/main.css (Hell/Dunkel, Namen wie in docs/PLAN.md). Die Token-Namen
// folgen der Mottulbox (shadcn-ähnlich), damit deren UI-Bausteine unverändert passen; was es dort
// nicht gibt (Leiste, Bühne, Akzent-Linie, zweite Schriftstufe), kommt dazu.
// Muster aus der Mottulbox übernommen (project_mega/tailwind.config.js).

/** Farbe aus einer Variablen mit RGB-Dreiergruppe, Deckkraft über Tailwind (`bg-primary/20`). */
const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: rgb('bg'),
        foreground: rgb('text'),
        // Werte (zweite Stufe) und Hinweise (dritte Stufe)
        'foreground-2': rgb('text2'),
        'muted-foreground': rgb('text3'),
        // Titelleiste, Seitenleisten, Statusleiste
        leiste: rgb('leiste'),
        card: rgb('karte'),
        // gewählt, Chips
        muted: rgb('gedaempft'),
        accent: rgb('gedaempft'),
        'accent-foreground': rgb('text'),
        border: rgb('rand'),
        'border-strong': rgb('rand-stark'),
        input: rgb('rand-stark'),
        // Hellgrün: Fläche mit dunkler Schrift (beide Modi gleich)
        primary: rgb('akzent'),
        'primary-foreground': rgb('auf-akzent'),
        // Hellgrün für Linien, Symbole, Links, Auswahlrahmen (im Hellmodus dunkler)
        'primary-line': rgb('akzent-linie'),
        ring: rgb('akzent-linie'),
        // Status – nie die Akzentfarbe, immer mit Symbol und Text
        success: rgb('ok'),
        warning: rgb('gelb'),
        danger: rgb('fehler'),
        // Hintergrund hinter dem Bild im Betrachter
        buehne: rgb('buehne')
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', 'sans-serif']
      },
      borderRadius: {
        lg: '0.625rem',
        md: '0.5rem',
        sm: '0.375rem'
      }
    }
  },
  plugins: [
    // `light:`-Variante (Hellmodus = Klasse .light am <html>) für Ausnahmen ohne Token
    function ({ addVariant }) {
      addVariant('light', '.light &')
    }
  ]
}
