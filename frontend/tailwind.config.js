/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Maroon & Marigold. Chosen for contrast: these hold up on a cheap LCD
        // phone in daylight, which is where most of this shop's customers are.
        maroon: {
          50: '#FCF2F5',
          100: '#F7E0E7',
          200: '#EFC0CE',
          300: '#E094AB',
          400: '#C95B7C',
          500: '#A83358',
          600: '#7B1E3B',
          700: '#661630',
          800: '#4E1025',
          900: '#3A0B1B',
        },
        marigold: {
          50: '#FEF9EE',
          100: '#FDF0D5',
          200: '#FADFA6',
          300: '#F5C46B',
          400: '#EFB04C',
          500: '#E8A33D',
          600: '#C8802A',
          700: '#9E6120',
          800: '#7A4A1C',
          900: '#5E3916',
        },
        cream: '#FDF8F0',
        ink: {
          DEFAULT: '#2B2118',
          muted: '#6B5C4D',
          light: '#9A8B7C',
        },
        leaf: '#1F7A4D',
        alert: '#B3261E',
      },
      fontFamily: {
        sans: ['"Noto Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Noto Serif"', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(43, 33, 24, 0.06), 0 4px 16px rgba(43, 33, 24, 0.06)',
        lift: '0 8px 28px rgba(43, 33, 24, 0.14)',
        sheet: '0 -6px 28px rgba(43, 33, 24, 0.16)',
      },
      borderRadius: {
        xl2: '1.125rem',
      },
      keyframes: {
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'slide-up': 'slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 160ms ease-out',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
