/**
 * Keyboard input tracker for the surf game.
 * Tracks ArrowLeft, ArrowRight, and Space.
 */

const keys: Record<string, boolean> = {};

export function initControls(): void {
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    // Prevent Space from scrolling the page
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });
}

export function getInput(): { left: boolean; right: boolean; jump: boolean } {
  return {
    left:  !!keys['ArrowLeft'],
    right: !!keys['ArrowRight'],
    jump:  !!keys['Space'],
  };
}
