/**
 * Surf physics tuning constants.
 *
 * Single source of truth for every tunable value in the 2D surf physics.
 * Flat object — access as SURF.GRAVITY, not SURF.forces.gravity.
 *
 * Design: arcade toy, NOT simulation. Gravity is low, friction is minimal,
 * carve and pump are generous. The wave should feel like a playground.
 */

export const SURF = Object.freeze({
  // --- Gravity & projection ---
  GRAVITY: 4.0,                   // arcade gravity — about 40% of real g

  // --- Edge / carve ---
  EDGE_BUILD_RATE: 6.0,           // 1/s — snappy edge response
  EDGE_RELEASE_RATE: 2.0,         // 1/s — edge holds a bit after releasing keys
  EDGE_FLIP_PENALTY: 0.5,         // multiplier on build rate when reversing
  EDGE_CARVE_FORCE: 18.0,         // m/s² peak carve force — the main speed engine
  EDGE_PROPAGATION_BONUS: 3.0,    // carve multiplier on energetic (rising) face

  // --- Wave push (free energy from the wave face) ---
  WAVE_PUSH_STRENGTH: 6.0,        // m/s² baseline acceleration from the moving wave

  // --- Pump ---
  PUMP_IMPULSE: 8.0,              // m/s speed boost on successful pump
  PUMP_COOLDOWN: 0.25,            // seconds between pumps — fast rhythm
  PUMP_SLOPE_WINDOW: 0.5,         // wider window — more forgiving timing
  PUMP_WAVEFRONT_BONUS: 1.5,      // pump bonus on rising face

  // --- Brake ---
  BRAKE_DRAG: 10.0,               // m/s² deceleration when braking
  BRAKE_MIN_SPEED: 0.2,

  // --- Friction & drag ---
  ROLLING_FRICTION: 0.05,         // nearly nothing — speed persists
  QUADRATIC_DRAG: 0.002,          // very light high-speed drag
  SPEED_FLOOR: 0.05,

  // --- Ground adhesion & detach ---
  SURFACE_SNAP_TOLERANCE: 0.05,
  AUTO_LAUNCH_ZDOT: 3.0,          // raised slightly — don't launch too easily
  AUTO_LAUNCH_SPEED: 5.0,         // need decent speed to auto-launch

  // --- Landing alignment ---
  LANDING_GOOD_DOT: 0.5,          // more forgiving — easier to land cleanly
  LANDING_PRESERVE_GOOD: 0.92,    // keep almost all speed on good landing
  LANDING_PRESERVE_BAD: 0.50,     // even bad landings keep half

  // --- Air physics ---
  AIR_STEER: 2.5,                 // strong air control
  AIR_DRAG: 0.998,                // barely any air drag

  // --- Speed limits ---
  MAX_GROUND_SPEED: 50,
  MAX_AIR_VX: 44,
  MAX_AIR_VZ: 50,

  // --- Jump ---
  JUMP_BASE: 5.0,
  JUMP_SPEED_SCALE: 0.3,
  JUMP_MAX: 14.0,

  // --- Wave interaction ---
  WAVE_LIFT_MAX: 5.0,
});
