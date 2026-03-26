/**
 * Keyboard input tracker for the surf game.
 *
 * Tracks both Arrow keys and WASD:
 *   A / ArrowLeft   — carve left
 *   D / ArrowRight  — carve right
 *   W / ArrowUp     — pump
 *   S / ArrowDown   — brake
 *   Space           — jump
 *   R               — respawn
 *   Backtick (`)    — toggle debug overlay
 */

export interface GameInput {
  left: boolean;
  right: boolean;
  pump: boolean;
  brake: boolean;
  jump: boolean;
  respawn: boolean;
  debug: boolean;
}

const keys: Record<string, boolean> = {};
let debugOn = false;
let backtickWasDown = false;

export function initControls(): void {
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });
}

export function getInput(): GameInput {
  // Toggle debug on backtick rising edge
  const backtickDown = !!keys['Backquote'];
  if (backtickDown && !backtickWasDown) debugOn = !debugOn;
  backtickWasDown = backtickDown;

  return {
    left:    !!keys['ArrowLeft']  || !!keys['KeyA'],
    right:   !!keys['ArrowRight'] || !!keys['KeyD'],
    pump:    !!keys['ArrowUp']    || !!keys['KeyW'],
    brake:   !!keys['ArrowDown']  || !!keys['KeyS'],
    jump:    !!keys['Space'],
    respawn: !!keys['KeyR'],
    debug:   debugOn,
  };
}
