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
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps
} from "@xyflow/react";

const SELECTED_EDGE_STROKE = "rgba(92, 221, 229, 0.96)";
const SELECTED_EDGE_WIDTH = 2.8;

type WorkflowEdgeData = {
  onInsertBetween?: (sourceId: string, targetId: string) => void;
  sourceId: string;
  targetId: string;
};

export function WorkflowEdge({
  data,
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
  const edgeData = isWorkflowEdgeData(data) ? data : null;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY
  });
  const stroke =
    selected
      ? SELECTED_EDGE_STROKE
      : asStringStyle(style?.stroke, "rgba(121, 141, 242, 0.68)");
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
      {selected && edgeData?.onInsertBetween ? (
        <EdgeLabelRenderer>
          <button
            aria-label="Insert step on connection"
            className="nodrag nopan absolute flex h-8 w-8 items-center justify-center rounded-full border border-[#7c8fff]/22 bg-white text-base font-medium text-[#5e86ff] shadow-[0_10px_24px_rgba(94,134,255,0.14)] transition hover:border-[#7c8fff]/36 hover:bg-[#eef3ff]"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              edgeData.onInsertBetween?.(edgeData.sourceId, edgeData.targetId);
            }}
            style={{
              pointerEvents: "all",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
            }}
            type="button"
          >
            +
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function isWorkflowEdgeData(value: unknown): value is WorkflowEdgeData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkflowEdgeData>;
  return (
    typeof candidate.sourceId === "string" &&
    typeof candidate.targetId === "string" &&
    (candidate.onInsertBetween === undefined ||
      typeof candidate.onInsertBetween === "function")
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
