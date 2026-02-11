/**
 * History (undo/redo) processing functions for the drawing plugin
 * All functions are pure - they take action data and return mutations to apply
 */

import { cloneElement } from "./geometry.js";
import type {
  DrawingElement,
  MovePosition,
  Point,
  UndoAction,
} from "./types.js";
import { isLine, isPath, isShape, isText } from "./types.js";

/**
 * Apply a MovePosition to a DrawingElement, using type guards for safe narrowing.
 * The MovePosition discriminant ("x" vs "points") must match the element type.
 */
function applyMovePosition(el: DrawingElement, pos: MovePosition): void {
  if ("x" in pos && (isShape(el) || isText(el))) {
    el.x = pos.x;
    el.y = pos.y;
  } else if ("points" in pos) {
    if (isPath(el)) {
      el.points = pos.points;
    } else if (isLine(el)) {
      el.points = pos.points as [Point, Point];
      if ("midpoint" in pos) {
        el.midpoint = pos.midpoint;
      }
    }
  }
}

/**
 * Result of processing an undo/redo action
 */
export interface HistoryResult {
  /** Elements to set (id → element) */
  elementsToSet: Array<[string, DrawingElement]>;
  /** Element IDs to delete */
  elementsToDelete: string[];
}

/**
 * Process an undo action and return the mutations to apply
 */
export function processUndo(
  action: UndoAction,
  elements: Map<string, DrawingElement>
): HistoryResult {
  const result: HistoryResult = {
    elementsToSet: [],
    elementsToDelete: [],
  };

  switch (action.action) {
    case "add":
      // Remove the added element
      result.elementsToDelete.push(action.data.id);
      break;

    case "remove":
      // Re-add the removed element
      result.elementsToSet.push([action.data.id, action.data]);
      break;

    case "move":
      // Restore original positions
      for (const item of action.data) {
        const el = elements.get(item.id);
        if (!el) continue;

        const updated = cloneElement(el);
        applyMovePosition(updated, item.before);
        result.elementsToSet.push([item.id, updated]);
      }
      break;

    case "resize":
      // Restore element to state before resize
      result.elementsToSet.push([action.data.id, action.data.before]);
      break;

    case "rotate":
      // Restore element to state before rotation
      result.elementsToSet.push([action.data.id, action.data.before]);
      break;

    case "group-resize":
      // Restore all elements to state before group resize
      for (const item of action.data) {
        result.elementsToSet.push([item.id, item.before]);
      }
      break;

    case "group-rotate":
      // Restore all elements to state before group rotation
      for (const item of action.data) {
        result.elementsToSet.push([item.id, item.before]);
      }
      break;
  }

  return result;
}

/**
 * Process a redo action and return the mutations to apply
 */
export function processRedo(
  action: UndoAction,
  elements: Map<string, DrawingElement>
): HistoryResult {
  const result: HistoryResult = {
    elementsToSet: [],
    elementsToDelete: [],
  };

  switch (action.action) {
    case "add":
      // Re-add the element
      result.elementsToSet.push([action.data.id, action.data]);
      break;

    case "remove":
      // Re-remove the element
      result.elementsToDelete.push(action.data.id);
      break;

    case "move":
      // Re-apply move positions
      for (const item of action.data) {
        const el = elements.get(item.id);
        if (!el) continue;

        const updated = cloneElement(el);
        applyMovePosition(updated, item.after);
        result.elementsToSet.push([item.id, updated]);
      }
      break;

    case "resize":
      // Re-apply resize (restore to state after resize)
      result.elementsToSet.push([action.data.id, action.data.after]);
      break;

    case "rotate":
      // Re-apply rotation (restore to state after rotation)
      result.elementsToSet.push([action.data.id, action.data.after]);
      break;

    case "group-resize":
      // Re-apply group resize (restore all elements to state after resize)
      for (const item of action.data) {
        result.elementsToSet.push([item.id, item.after]);
      }
      break;

    case "group-rotate":
      // Re-apply group rotation (restore all elements to state after rotation)
      for (const item of action.data) {
        result.elementsToSet.push([item.id, item.after]);
      }
      break;
  }

  return result;
}

/**
 * Create an "add" action for a new element
 */
export function createAddAction(element: DrawingElement): UndoAction {
  return { action: "add", data: element };
}

/**
 * Create a "remove" action for a deleted element
 */
export function createRemoveAction(element: DrawingElement): UndoAction {
  return { action: "remove", data: element };
}

/**
 * Create a "move" action for moved elements
 */
export function createMoveAction(
  moves: Array<{ id: string; before: { x: number; y: number }; after: { x: number; y: number } }>
): UndoAction {
  return { action: "move", data: moves };
}

/**
 * Create a "resize" action for a resized element
 */
export function createResizeAction(
  id: string,
  before: DrawingElement,
  after: DrawingElement
): UndoAction {
  return { action: "resize", data: { id, before, after } };
}

/**
 * Create a "rotate" action for a rotated element
 */
export function createRotateAction(
  id: string,
  before: DrawingElement,
  after: DrawingElement
): UndoAction {
  return { action: "rotate", data: { id, before, after } };
}

/**
 * Create a "group-resize" action for multiple resized elements
 */
export function createGroupResizeAction(
  items: Array<{ id: string; before: DrawingElement; after: DrawingElement }>
): UndoAction {
  return { action: "group-resize", data: items };
}

/**
 * Create a "group-rotate" action for multiple rotated elements
 */
export function createGroupRotateAction(
  items: Array<{ id: string; before: DrawingElement; after: DrawingElement }>
): UndoAction {
  return { action: "group-rotate", data: items };
}
