"use client";

/*
 * Copyright 2026 Achsah Systems
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps
} from "@xyflow/react";

const SELECTED_EDGE_STROKE = "rgba(15, 108, 115, 0.92)";
const SELECTED_EDGE_WIDTH = 2.8;

export function WorkflowEdge({
  id,
  markerEnd,
  selected,
  sourcePosition,
  sourceX,
  sourceY,
  style,
  targetPosition,
  targetX,
  targetY
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY
  });
  const stroke =
    selected ? SELECTED_EDGE_STROKE : asStringStyle(style?.stroke, "rgba(16, 26, 29, 0.64)");
  const strokeWidth = selected
    ? SELECTED_EDGE_WIDTH
    : asNumericStyle(style?.strokeWidth, 2);
  const markerId = `workflow-edge-marker-${sanitizeMarkerId(id)}`;

  return (
    <>
      <defs>
        <marker
          className="react-flow__arrowhead"
          id={markerId}
          markerHeight="18"
          markerUnits="strokeWidth"
          markerWidth="18"
          orient="auto-start-reverse"
          refX="0"
          refY="0"
          viewBox="-10 -10 20 20"
        >
          <polyline
            points="-5,-4 0,0 -5,4 -5,-4"
            style={{
              fill: stroke,
              stroke,
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: Math.max(1, strokeWidth * 0.55)
            }}
          />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        markerEnd={markerEnd ? `url('#${markerId}')` : undefined}
        path={edgePath}
        style={{
          ...style,
          stroke,
          strokeWidth
        }}
      />
    </>
  );
}

function asNumericStyle(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function asStringStyle(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function sanitizeMarkerId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}
