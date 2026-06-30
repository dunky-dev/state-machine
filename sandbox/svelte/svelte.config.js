import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  // Lets `<script lang="ts">` blocks be transpiled by Vite's esbuild.
  preprocess: vitePreprocess(),
}
