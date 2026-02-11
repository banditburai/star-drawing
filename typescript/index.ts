/**
 * star-drawing barrel export
 * Framework-agnostic SVG drawing canvas
 */

// Re-export all types
export * from "./types.js";

// Re-export constants
export * from "./constants.js";

// Re-export geometry utilities
export * from "./geometry.js";

// Re-export rendering functions
export * from "./renderers.js";

// Re-export history functions
export * from "./history.js";

// Re-export controller and callbacks interface
export { DrawingController } from "./controller.js";
export type { DrawingCallbacks } from "./controller.js";

