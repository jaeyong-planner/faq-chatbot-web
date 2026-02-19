/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'gray-900': '#1a202c',
        'gray-800': '#2d3748',
        'gray-700': '#4a5568',
        'gray-600': '#718096',
        'gray-500': '#a0aec0',
        'gray-200': '#e2e8f0',
        'indigo-500': '#667eea',
        'indigo-600': '#5a67d8',
      }
    }
  },
  plugins: [],
}
