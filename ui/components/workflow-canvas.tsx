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
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
  type XYPosition
} from "@xyflow/react";

import {
  type CanvasNode,
  EDGE_STROKE,
  TRIGGER_NODE_ID
} from "../lib/workflow-editor";
import { WorkflowEdge } from "./workflow-edge";
import { WorkflowNode } from "./workflow-node";

type WorkflowCanvasProps = {
  edges: Edge[];
  frameRequestKey?: number;
  nodes: CanvasNode[];
  onInsertBetween: (sourceId: string, targetId: string) => void;
  onRequestAddAfterNode: (nodeId: string) => void;
  onAttachStepToTrigger: (stepId: string) => void;
  onDeleteStep: (stepId: string) => void;
  onEdgesCommit: (edges: Edge[]) => void;
  onPositionsCommit: (positions: Record<string, XYPosition>) => void;
  onSelectNode: (nodeId: string | null) => void;
  readOnly?: boolean;
  showControls?: boolean;
  showMiniMap?: boolean;
  showViewportPanel?: boolean;
};

export function WorkflowCanvas({
  edges,
  frameRequestKey = 0,
  nodes,
  onInsertBetween,
  onRequestAddAfterNode,
  onAttachStepToTrigger,
  onDeleteStep,
  onEdgesCommit,
  onPositionsCommit,
  onSelectNode,
  readOnly = false,
  showControls = true,
  showMiniMap = true,
  showViewportPanel = true
}: WorkflowCanvasProps) {
  const [localNodes, setLocalNodes] = useState<CanvasNode[]>(() =>
    attachNodeActions(nodes, onDeleteStep, readOnly ? null : onRequestAddAfterNode)
  );
  const [localEdges, setLocalEdges] = useState<Edge[]>(() =>
    attachEdgeActions(edges, readOnly ? null : onInsertBetween)
  );
  const localNodesRef = useRef<CanvasNode[]>(nodes);
  const localEdgesRef = useRef<Edge[]>(edges);
  const nodeTypes = useMemo<NodeTypes>(
    () => ({ workflowNode: WorkflowNode as NodeTypes[string] }),
    []
  );
  const edgeTypes = useMemo<EdgeTypes>(
    () => ({ workflowEdge: WorkflowEdge as EdgeTypes[string] }),
    []
  );

  useEffect(() => {
    localNodesRef.current = localNodes;
  }, [localNodes]);

  useEffect(() => {
    localEdgesRef.current = localEdges;
  }, [localEdges]);

  useEffect(() => {
    setLocalNodes((current) =>
      attachNodeActions(
        nodes,
        onDeleteStep,
        readOnly ? null : onRequestAddAfterNode,
        current
      )
    );
  }, [nodes, onDeleteStep, onRequestAddAfterNode, readOnly]);

  useEffect(() => {
    setLocalEdges((current) =>
      attachEdgeActions(edges, readOnly ? null : onInsertBetween, current)
    );
  }, [edges, onInsertBetween, readOnly]);

  function handleNodesChange(changes: NodeChange<CanvasNode>[]) {
    if (readOnly) {
      return;
    }
    const removedIds = changes
      .filter(
        (change): change is Extract<NodeChange<CanvasNode>, { id: string; type: "remove" }> =>
          change.type === "remove" && "id" in change && change.id !== TRIGGER_NODE_ID
      )
      .map((change) => change.id);
    if (removedIds.length > 0) {
      removedIds.forEach((stepId) => onDeleteStep(stepId));
      return;
    }

    setLocalNodes((current) => applyNodeChanges(changes, current));
  }

  function handleNodeDragStop(_: unknown, node: CanvasNode) {
    if (readOnly) {
      return;
    }
    const nextPositions = positionsFromNodes(localNodesRef.current, node.id, node.position);
    onPositionsCommit(nextPositions);
  }

  function handleEdgesChange(changes: EdgeChange<Edge>[]) {
    if (readOnly) {
      return;
    }
    const nextEdges = applyEdgeChanges(changes, localEdgesRef.current);
    setLocalEdges(nextEdges);
    if (changes.some((change) => change.type === "remove")) {
      onEdgesCommit(nextEdges);
    }
  }

  const handleDeleteEdges = useCallback(
    (edgeIds: string[]) => {
      if (edgeIds.length === 0) {
        return;
      }

      const nextEdges = localEdgesRef.current.filter((edge) => !edgeIds.includes(edge.id));
      setLocalEdges(nextEdges);
      onEdgesCommit(nextEdges);
    },
    [onEdgesCommit]
  );

  function handleConnect(connection: Connection) {
    if (readOnly) {
      return;
    }
    if (
      !connection.source ||
      !connection.target ||
      connection.target === TRIGGER_NODE_ID ||
      connection.source === connection.target
    ) {
      return;
    }

    if (connection.source === TRIGGER_NODE_ID) {
      onAttachStepToTrigger(connection.target);
      return;
    }

    const nextEdges = addEdge(
      {
        ...connection,
        id: `${connection.source}->${connection.target}`,
        markerEnd: {
          color: EDGE_STROKE,
          height: 18,
          type: MarkerType.ArrowClosed,
          width: 18
        },
        style: {
          stroke: EDGE_STROKE,
          strokeWidth: 2
        },
        type: "workflowEdge"
      },
      localEdgesRef.current
    );
    setLocalEdges(nextEdges);
    onEdgesCommit(nextEdges);
  }

  useEffect(() => {
    if (readOnly) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.closest("input, textarea, select, [contenteditable='true']") !== null ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      if (event.key !== "Backspace" && event.key !== "Delete") {
        return;
      }

      const selectedEdgeIds = localEdgesRef.current
        .filter((edge) => edge.selected)
        .map((edge) => edge.id);
      if (selectedEdgeIds.length > 0) {
        event.preventDefault();
        handleDeleteEdges(selectedEdgeIds);
        return;
      }

      const selectedStepIds = localNodesRef.current
        .filter((node) => node.selected && node.id !== TRIGGER_NODE_ID)
        .map((node) => node.id);
      if (selectedStepIds.length > 0) {
        event.preventDefault();
        selectedStepIds.forEach((stepId) => onDeleteStep(stepId));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDeleteEdges, onDeleteStep, readOnly]);

  return (
    <ReactFlowProvider>
      <ReactFlow
        connectionLineType={ConnectionLineType.Step}
        defaultEdgeOptions={{
          markerEnd: {
            color: EDGE_STROKE,
            height: 18,
            type: MarkerType.ArrowClosed,
            width: 18
          },
          style: {
            stroke: EDGE_STROKE,
            strokeWidth: 2
          },
          type: "workflowEdge"
        }}
        deleteKeyCode={null}
        defaultViewport={{ x: 0, y: 0, zoom: 0.92 }}
        edges={localEdges}
        edgesReconnectable={false}
        edgeTypes={edgeTypes}
        maxZoom={1.6}
        minZoom={0.35}
        nodeTypes={nodeTypes}
        nodes={localNodes}
        nodesDraggable={!readOnly}
        onConnect={readOnly ? undefined : handleConnect}
        onEdgesChange={readOnly ? undefined : handleEdgesChange}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodeDragStop={readOnly ? undefined : handleNodeDragStop}
        onNodesChange={readOnly ? undefined : handleNodesChange}
        onPaneClick={() => onSelectNode(null)}
        panOnDrag={false}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        selectionMode={SelectionMode.Partial}
        selectionOnDrag={false}
        snapGrid={[20, 20]}
        snapToGrid
        zoomOnDoubleClick={false}
        zoomOnScroll={false}
      >
        <InitialFrame frameRequestKey={frameRequestKey} nodeCount={localNodes.length} />
        {showViewportPanel ? <ViewportPanel /> : null}
        {showMiniMap ? (
          <MiniMap
            pannable
            zoomable
            className="!rounded-xl !border !border-black/10 !bg-white/90"
          />
        ) : null}
        {showControls ? (
          <Controls className="!rounded-xl !border !border-black/10 !bg-white/90" />
        ) : null}
        <Background
          color="rgba(16, 26, 29, 0.035)"
          gap={28}
          size={1}
          variant={BackgroundVariant.Lines}
        />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

function InitialFrame({
  frameRequestKey,
  nodeCount
}: {
  frameRequestKey: number;
  nodeCount: number;
}) {
  const hasFramedOnMount = useRef(false);
  const nodesInitialized = useNodesInitialized();
  const reactFlow = useReactFlow();

  useEffect(() => {
    if (!nodesInitialized || hasFramedOnMount.current || nodeCount === 0) {
      return;
    }

    hasFramedOnMount.current = true;
    const frameId = window.requestAnimationFrame(() => {
      void reactFlow.fitView({ duration: 0, maxZoom: 1.05, padding: 0.18 });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [nodeCount, nodesInitialized, reactFlow]);

  useEffect(() => {
    if (!nodesInitialized || frameRequestKey === 0) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      void reactFlow.fitView({ duration: 180, maxZoom: 1.05, padding: 0.18 });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [frameRequestKey, nodesInitialized, reactFlow]);

  return null;
}

function attachNodeActions(
  nodes: CanvasNode[],
  onDeleteStep: (stepId: string) => void,
  onAddAfterNode: ((nodeId: string) => void) | null,
  currentNodes: CanvasNode[] = []
) {
  const selectedNodeIds = new Set(
    currentNodes.filter((node) => node.selected).map((node) => node.id)
  );

  return nodes.map((node) => ({
    ...node,
    selected: selectedNodeIds.has(node.id),
    data: {
      ...node.data,
      onAddAfter: onAddAfterNode,
      onDelete: node.data.kind === "step" ? onDeleteStep : null
    }
  }));
}

function attachEdgeActions(
  edges: Edge[],
  onInsertBetween: ((sourceId: string, targetId: string) => void) | null,
  currentEdges: Edge[] = []
) {
  const selectedEdgeIds = new Set(
    currentEdges.filter((edge) => edge.selected).map((edge) => edge.id)
  );

  return edges.map((edge) => ({
    ...edge,
    selected: selectedEdgeIds.has(edge.id),
    data: onInsertBetween
      ? {
          ...(typeof edge.data === "object" && edge.data !== null ? edge.data : {}),
          onInsertBetween,
          sourceId: edge.source,
          targetId: edge.target
        }
      : edge.data
  }));
}

function positionsFromNodes(
  nodes: CanvasNode[],
  draggedNodeId: string,
  draggedPosition: XYPosition
): Record<string, XYPosition> {
  return Object.fromEntries(
    nodes.map((node) => [
      node.id,
      node.id === draggedNodeId ? draggedPosition : node.position
    ])
  );
}

function ViewportPanel() {
  const reactFlow = useReactFlow();

  return (
    <Panel position="top-right">
      <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-white/92 p-2">
        <button
          className="ui-button !px-2.5 !py-2 !text-[10px]"
          onClick={() => void reactFlow.fitView({ duration: 180, maxZoom: 1.05, padding: 0.18 })}
          type="button"
        >
          Frame
        </button>
        <button
          className="ui-button !px-2.5 !py-2 !text-[10px]"
          onClick={() => void reactFlow.setViewport({ x: 0, y: 0, zoom: 0.92 }, { duration: 180 })}
          type="button"
        >
          Reset zoom
        </button>
      </div>
    </Panel>
  );
}
