import type { Config } from 'tailwindcss';

/**
 * ReliefRelay design tokens.
 * Warm off-white surfaces, deep teal primary, restrained orange for attention.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sand: {
          50: '#FBF8F3',
          100: '#F5EFE6',
          200: '#E9E0D2',
          300: '#D8CCB8',
        },
        teal: {
          50: '#EAF5F4',
          100: '#CDE7E4',
          300: '#6FB3AD',
          500: '#17807A',
          600: '#0F6B66',
          700: '#0A544F',
          900: '#06332F',
        },
        ember: {
          50: '#FDF1E7',
          100: '#FADFC9',
          500: '#C2560F',
          600: '#A4470B',
          700: '#7E3607',
        },
        ink: {
          500: '#6B6558',
          700: '#3D3A33',
          900: '#1F1D19',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(31,29,25,0.06), 0 8px 24px -12px rgba(31,29,25,0.18)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
};

export default config;
