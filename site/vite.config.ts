import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The loader in index.html paints before anything else, and its own critical
// CSS is already inline. A render-blocking <link> for the page's ~23kB sheet
// costs a whole extra request+RTT on top of that for a single-document,
// cold-visit-dominated landing page — deferring it was considered and
// rejected (the loader is transparent, not opaque, so unstyled markup would
// flash through). Inlining removes the request entirely instead.
// ponytail: the sheet stops being separately cacheable across visits — the
// right trade here since there's only one route. Revisit if this page ever
// grows a second one.
function inlineCss(): Plugin {
  return {
    name: 'gg-inline-css',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle
        if (!bundle) return html
        // Replace each injected <link rel="stylesheet"> in place — same spot
        // in <head> the link occupied, right after the loader's own <style>
        // block — so the cascade order (loader CSS first, page CSS after)
        // is unchanged and nothing in the loader gets shadowed.
        return html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (tag, href: string) => {
          const fileName = href.replace(/^\//, '')
          const asset = bundle[fileName]
          if (!asset || asset.type !== 'asset') return tag
          const css = typeof asset.source === 'string' ? asset.source : asset.source.toString()
          delete bundle[fileName]
          return `<style>${css}</style>`
        })
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), inlineCss()],
  server: { port: 5179, strictPort: true },
  preview: { port: 5179, strictPort: true },
})
