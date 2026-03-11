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
  type NodeChange,
  type NodeTypes,
  type XYPosition
} from "@xyflow/react";

import {
  type CanvasNode,
  EDGE_STROKE,
  TRIGGER_NODE_ID
} from "../lib/workflow-editor";
import { WorkflowNode } from "./workflow-node";

type WorkflowCanvasProps = {
  edges: Edge[];
  nodes: CanvasNode[];
  onDeleteStep: (stepId: string) => void;
  onEdgesCommit: (edges: Edge[]) => void;
  onPositionsCommit: (positions: Record<string, XYPosition>) => void;
  onSelectNode: (nodeId: string | null) => void;
};

export function WorkflowCanvas({
  edges,
  nodes,
  onDeleteStep,
  onEdgesCommit,
  onPositionsCommit,
  onSelectNode
}: WorkflowCanvasProps) {
  const [localNodes, setLocalNodes] = useState<CanvasNode[]>(nodes);
  const [localEdges, setLocalEdges] = useState<Edge[]>(edges);
  const localNodesRef = useRef<CanvasNode[]>(nodes);
  const nodeTypes = useMemo<NodeTypes>(
    () => ({ workflowNode: WorkflowNode as NodeTypes[string] }),
    []
  );

  useEffect(() => {
    localNodesRef.current = localNodes;
  }, [localNodes]);

  useEffect(() => {
    setLocalNodes(nodes);
  }, [nodes]);

  useEffect(() => {
    setLocalEdges(edges);
  }, [edges]);

  function handleNodesChange(changes: NodeChange<CanvasNode>[]) {
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
    const nextPositions = positionsFromNodes(localNodesRef.current, node.id, node.position);
    onPositionsCommit(nextPositions);
  }

  function handleEdgesChange(changes: EdgeChange<Edge>[]) {
    setLocalEdges((current) => {
      const nextEdges = applyEdgeChanges(changes, current);
      if (changes.some((change) => change.type === "remove")) {
        onEdgesCommit(nextEdges);
      }
      return nextEdges;
    });
  }

  function handleConnect(connection: Connection) {
    if (
      !connection.source ||
      !connection.target ||
      connection.source === TRIGGER_NODE_ID ||
      connection.target === TRIGGER_NODE_ID ||
      connection.source === connection.target
    ) {
      return;
    }

    setLocalEdges((current) => {
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
          type: "step"
        },
        current
      );
      onEdgesCommit(nextEdges);
      return nextEdges;
    });
  }

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
          type: "step"
        }}
        defaultViewport={{ x: 0, y: 0, zoom: 0.92 }}
        edges={localEdges}
        edgesReconnectable={false}
        maxZoom={1.6}
        minZoom={0.35}
        nodeTypes={nodeTypes}
        nodes={localNodes}
        nodesDraggable
        onConnect={handleConnect}
        onEdgesChange={handleEdgesChange}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodeDragStop={handleNodeDragStop}
        onNodesChange={handleNodesChange}
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
        <InitialFrame nodeCount={localNodes.length} />
        <ViewportPanel />
        <MiniMap
          pannable
          zoomable
          className="!rounded-xl !border !border-black/10 !bg-white/85"
        />
        <Controls className="!rounded-xl !border !border-black/10 !bg-white/85" />
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

function InitialFrame({ nodeCount }: { nodeCount: number }) {
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

  return null;
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
      <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-white/90 p-2 backdrop-blur">
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
