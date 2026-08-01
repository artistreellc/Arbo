/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Art-is-Tree brand greens, reused across the CRM chrome.
        brand: {
          DEFAULT: '#1B4D3E',
          dark: '#153e32',
          deep: '#12352b',
          accent: '#2A7A5E',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
