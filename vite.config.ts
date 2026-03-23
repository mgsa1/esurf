import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        visualizer: 'index.html',
        game: 'game.html',
      },
    },
  },
});
