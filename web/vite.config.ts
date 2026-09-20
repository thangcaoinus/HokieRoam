import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// PUBLIC_BASE is set only for the GitHub Pages build (`PUBLIC_BASE=/VTHax14/ npm run build`),
// where the site is served from a project subpath rather than the domain root. Local dev, preview
// and every browser check in scripts/ keep the default `/` so none of them has to know about it.
// `cachedExample.ts` already builds its artifact URLs from import.meta.env.BASE_URL, and Vite
// rewrites the `/fonts/...` references in index.html and styles.css to match.
export default defineConfig({
  base: process.env.PUBLIC_BASE ?? '/',
  plugins: [react()],
})
