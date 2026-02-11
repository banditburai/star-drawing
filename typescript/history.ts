import { cloneElement } from "./geometry.js";
import type {
  DrawingElement,
  MovePosition,
  Point,
  UndoAction,
} from "./types.js";
import { isLine, isPath, isShape, isText } from "./types.js";

// The MovePosition discriminant ("x" vs "points") must match the element type.
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

export interface HistoryResult {
  elementsToSet: Array<[string, DrawingElement]>;
  elementsToDelete: string[];
}

export function processHistory(
  action: UndoAction,
  elements: Map<string, DrawingElement>,
  direction: "undo" | "redo",
): HistoryResult {
  const result: HistoryResult = { elementsToSet: [], elementsToDelete: [] };
  const isUndo = direction === "undo";

  switch (action.action) {
    case "add":
      if (isUndo) {
        result.elementsToDelete.push(action.data.id);
      } else {
        result.elementsToSet.push([action.data.id, action.data]);
      }
      break;

    case "remove":
      if (isUndo) {
        result.elementsToSet.push([action.data.id, action.data]);
      } else {
        result.elementsToDelete.push(action.data.id);
      }
      break;

    case "remove_batch":
      for (const el of action.data) {
        if (isUndo) {
          result.elementsToSet.push([el.id, el]);
        } else {
          result.elementsToDelete.push(el.id);
        }
      }
      break;

    case "move":
      for (const item of action.data) {
        const el = elements.get(item.id);
        if (!el) continue;
        const updated = cloneElement(el);
        applyMovePosition(updated, isUndo ? item.before : item.after);
        result.elementsToSet.push([item.id, updated]);
      }
      break;

    case "modify":
      for (const item of action.data) {
        result.elementsToSet.push([item.id, isUndo ? item.before : item.after]);
      }
      break;
  }

  return result;
}
