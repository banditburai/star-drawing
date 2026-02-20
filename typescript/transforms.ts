import {
  getBoundingBox,
  rotatePoint,
} from "./geometry.js";
import type {
  BoundingBox,
  DrawingElement,
  GroupResizeState,
  GroupRotationState,
  LineElement,
  PathElement,
  Point,
  ResizeHandleType,
  TextBoundsMap,
  TextElement,
} from "./types.js";
import { isLine, isPath, isShape, isText } from "./types.js";

function remapPoints(points: Point[], oldBounds: BoundingBox, newBounds: BoundingBox): Point[] {
  const sx = oldBounds.width > 0 ? newBounds.width / oldBounds.width : 1;
  const sy = oldBounds.height > 0 ? newBounds.height / oldBounds.height : 1;
  return points.map(p => ({
    x: newBounds.x + (p.x - oldBounds.x) * sx,
    y: newBounds.y + (p.y - oldBounds.y) * sy,
  }));
}

export interface ResizeOptions {
  handleType: ResizeHandleType;
  startBounds: BoundingBox;
  dx: number;
  dy: number;
  rotation: number;
  maintainAspectRatio: boolean;
  resizeFromCenter: boolean;
}

// Corner-pair decomposition: edge handles use a full corner (not the midpoint)
// so the pair spans both axes — midpoints collapse single-axis and break the
// Preet Shihn unrotate maths.
function getFixedCorner(handleType: ResizeHandleType, bounds: BoundingBox): Point {
  const { x, y, width, height } = bounds;
  switch (handleType) {
    case "nw": return { x: x + width, y: y + height };
    case "ne": return { x, y: y + height };
    case "se": return { x, y };
    case "sw": return { x: x + width, y };
    case "n":  return { x, y: y + height };
    case "s":  return { x, y };
    case "e":  return { x, y };
    case "w":  return { x: x + width, y };
  }
}

// Rotation-aware resize using the Preet Shihn "corner-pair" approach:
// every resize is reduced to two diagonally-opposite corners in screen
// space so the same unrotate maths applies uniformly.
export function calculateResizeBounds(opts: ResizeOptions): BoundingBox {
  const { handleType, startBounds, dx, dy, rotation, maintainAspectRatio, resizeFromCenter } = opts;

  // Rotate screen delta into element-local (unrotated) space
  const rad = (-rotation * Math.PI) / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);
  const localDx = dx * cosR - dy * sinR;
  const localDy = dx * sinR + dy * cosR;

  let { x, y, width, height } = startBounds;

  switch (handleType) {
    case "se":
      width  += localDx;
      height += localDy;
      break;
    case "sw":
      x      += localDx;
      width  -= localDx;
      height += localDy;
      break;
    case "ne":
      width  += localDx;
      y      += localDy;
      height -= localDy;
      break;
    case "nw":
      x      += localDx;
      width  -= localDx;
      y      += localDy;
      height -= localDy;
      break;
    case "s":
      height += localDy;
      break;
    case "n":
      y      += localDy;
      height -= localDy;
      break;
    case "e":
      width  += localDx;
      break;
    case "w":
      x      += localDx;
      width  -= localDx;
      break;
  }

  if (maintainAspectRatio && startBounds.width > 0 && startBounds.height > 0) {
    const aspect = startBounds.width / startBounds.height;
    const isVerticalOnly  = handleType === "n" || handleType === "s";
    const isHorizontalOnly = handleType === "e" || handleType === "w";

    let targetW = width;
    let targetH = height;

    if (isVerticalOnly) {
      targetW = targetH * aspect;
    } else if (isHorizontalOnly) {
      targetH = targetW / aspect;
    } else {
      if (width / height > aspect) {
        targetH = targetW / aspect;
      } else {
        targetW = targetH * aspect;
      }
    }

    const dw = targetW - width;
    const dh = targetH - height;

    // Shift origin so the opposite edge stays fixed when growing toward the handle
    if (handleType.includes("w"))  x -= dw;
    if (handleType.includes("n"))  y -= dh;
    // Single-axis handles center the growth on the perpendicular axis
    if (isVerticalOnly)   x -= dw / 2;
    if (isHorizontalOnly) y -= dh / 2;

    width  = targetW;
    height = targetH;
  }

  // Alt key: keep the original center fixed
  if (resizeFromCenter) {
    const origCenter: Point = {
      x: startBounds.x + startBounds.width / 2,
      y: startBounds.y + startBounds.height / 2,
    };
    width  = Math.max(width, 1);
    height = Math.max(height, 1);
    return {
      x: origCenter.x - width / 2,
      y: origCenter.y - height / 2,
      width,
      height,
    };
  }

  if (width < 1) {
    if (handleType.includes("w")) x += width - 1;
    width = 1;
  }
  if (height < 1) {
    if (handleType.includes("n")) y += height - 1;
    height = 1;
  }

  // Drift compensation: pin the fixed corner at its screen position
  if (rotation !== 0) {
    const oldCenter: Point = {
      x: startBounds.x + startBounds.width / 2,
      y: startBounds.y + startBounds.height / 2,
    };
    const fixedLocal = getFixedCorner(handleType, startBounds);
    const fixedScreen = rotatePoint(fixedLocal, oldCenter, rotation);

    const newCenter: Point = { x: x + width / 2, y: y + height / 2 };
    const fixedLocalAfter = getFixedCorner(handleType, { x, y, width, height });
    const fixedScreenAfter = rotatePoint(fixedLocalAfter, newCenter, rotation);

    x += fixedScreen.x - fixedScreenAfter.x;
    y += fixedScreen.y - fixedScreenAfter.y;
  }

  return { x, y, width, height };
}

function positionTextInBounds(el: TextElement, bounds: BoundingBox): void {
  el.y = bounds.y;
  if (el.text_align === "center") {
    el.x = bounds.x + bounds.width / 2;
  } else if (el.text_align === "right") {
    el.x = bounds.x + bounds.width;
  } else {
    el.x = bounds.x;
  }
}

export function applyResize(
  element: DrawingElement,
  newBounds: BoundingBox,
  startBounds: BoundingBox,
  originalElement: DrawingElement,
  originalFontSize?: number,
): void {
  if (isShape(element)) {
    element.x = newBounds.x;
    element.y = newBounds.y;
    element.width = newBounds.width;
    element.height = newBounds.height;
  } else if (isText(element) && isText(originalElement)) {
    const baseFontSize = originalFontSize ?? originalElement.font_size;
    const scaleX = startBounds.width > 0 ? newBounds.width / startBounds.width : 1;
    const scaleY = startBounds.height > 0 ? newBounds.height / startBounds.height : 1;
    const scale = Math.sqrt(scaleX * scaleY);
    element.font_size = Math.max(0.5, baseFontSize * scale);
    if (originalElement.width !== undefined) {
      element.width = originalElement.width * scaleX;
    }
    positionTextInBounds(element, newBounds);
  } else if (isLine(element) && isLine(originalElement)) {
    element.points = remapPoints(originalElement.points, startBounds, newBounds) as [Point, Point];
  } else if (isPath(element) && isPath(originalElement)) {
    element.points = remapPoints(originalElement.points, startBounds, newBounds);
  }
}

export function applyTextReflow(element: TextElement, newBounds: BoundingBox): void {
  element.width = Math.max(5, newBounds.width);
  positionTextInBounds(element, newBounds);
}

export function applyGroupResize(
  newGroupBounds: BoundingBox,
  groupState: GroupResizeState,
  elements: Map<string, DrawingElement>,
): void {
  const oldBounds = groupState.groupBounds;
  const scaleX = oldBounds.width > 0 ? newGroupBounds.width / oldBounds.width : 1;
  const scaleY = oldBounds.height > 0 ? newGroupBounds.height / oldBounds.height : 1;

  for (const item of groupState.elements) {
    const el = elements.get(item.id);
    if (!el) continue;

    const relX = (item.bounds.x - oldBounds.x) * scaleX;
    const relY = (item.bounds.y - oldBounds.y) * scaleY;

    const newElementBounds: BoundingBox = {
      x: newGroupBounds.x + relX,
      y: newGroupBounds.y + relY,
      width: item.bounds.width * scaleX,
      height: item.bounds.height * scaleY,
    };

    applyResize(el, newElementBounds, item.bounds, item.originalElement);
  }
}

function setElementPosition(el: DrawingElement, newPos: Point, textBounds?: TextBoundsMap): void {
  if (isShape(el)) {
    const bbox = getBoundingBox(el, textBounds);
    el.x = newPos.x - bbox.width / 2;
    el.y = newPos.y - bbox.height / 2;
  } else if (isText(el)) {
    const bbox = getBoundingBox(el, textBounds);
    positionTextInBounds(el, {
      x: newPos.x - bbox.width / 2,
      y: newPos.y - bbox.height / 2,
      width: bbox.width,
      height: bbox.height,
    });
  } else if (isLine(el) || isPath(el)) {
    const bbox = getBoundingBox(el);
    const dx = newPos.x - (bbox.x + bbox.width / 2);
    const dy = newPos.y - (bbox.y + bbox.height / 2);
    el.points = el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) as typeof el.points;
    if (isLine(el) && el.midpoint) {
      el.midpoint = { x: el.midpoint.x + dx, y: el.midpoint.y + dy };
    }
  }
}

export function applyGroupRotation(
  newAngle: number,
  groupState: GroupRotationState,
  elements: Map<string, DrawingElement>,
  textBounds?: TextBoundsMap,
): void {
  const deltaAngle = newAngle - groupState.startAngle;
  const center = groupState.center;

  for (const item of groupState.elements) {
    const el = elements.get(item.id);
    if (!el) continue;

    if (isLine(el) && isLine(item.originalElement)) {
      el.points = [
        rotatePoint(item.originalElement.points[0], center, deltaAngle),
        rotatePoint(item.originalElement.points[1], center, deltaAngle),
      ];
      if (item.originalElement.midpoint) {
        el.midpoint = rotatePoint(item.originalElement.midpoint, center, deltaAngle);
      }
      el.rotation = 0;
    } else if (isPath(el) && isPath(item.originalElement)) {
      el.points = item.originalElement.points.map((p) => rotatePoint(p, center, deltaAngle));
      el.rotation = 0;
    } else {
      const newPos = rotatePoint(item.position, center, deltaAngle);
      setElementPosition(el, newPos, textBounds);
      el.rotation = item.rotation + deltaAngle;
    }
  }
}
