// Copyright 2026 Achsah Systems
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use client";

import { useState } from "react";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange
} from "@xyflow/react";
import YAML from "yaml";

import { NodeInspector } from "./node-inspector";
import { TopBar } from "./top-bar";
import { WorkflowExplorer } from "./workflow-explorer";

type CanvasNodeData = {
  label: string;
  note: string;
  params: Record<string, string>;
  typeName: string;
};

type CanvasNode = Node<CanvasNodeData>;
type WorkflowDraft = {
  description: string;
  edges: Edge[];
  id: string;
  name: string;
  nodes: CanvasNode[];
};

const INITIAL_WORKFLOWS: WorkflowDraft[] = [
  {
    id: "hello-http",
    name: "hello-http",
    description: "A foundation workflow with a cron trigger and one HTTP node.",
    nodes: [
      {
        id: "trigger",
        type: "input",
        position: { x: 80, y: 160 },
        data: {
          label: "Cron Trigger",
          note: "Reloads from YAML and becomes the future scheduling entrypoint.",
          params: { schedule: "0 */6 * * * *" },
          typeName: "cron"
        }
      },
      {
        id: "fetch_status",
        position: { x: 360, y: 160 },
        data: {
          label: "HTTP Request",
          note: "Phase 4 will bind this node to the built-in HTTP executor.",
          params: {
            method: "GET",
            url: "https://example.com/health"
          },
          typeName: "http_request"
        }
      }
    ],
    edges: [
      {
        id: "trigger-fetch_status",
        source: "trigger",
        target: "fetch_status",
        animated: true
      }
    ]
  },
  {
    id: "approvals-pipeline",
    name: "approvals-pipeline",
    description: "A future-facing AI and approval workflow placeholder.",
    nodes: [
      {
        id: "manual",
        type: "input",
        position: { x: 100, y: 140 },
        data: {
          label: "Manual Trigger",
          note: "Useful for local testing during early engine phases.",
          params: {},
          typeName: "manual"
        }
      },
      {
        id: "classify_ticket",
        position: { x: 380, y: 140 },
        data: {
          label: "Classify Ticket",
          note: "AI primitives land in Phase 4.",
          params: {
            model: "provider/model",
            task: "classification"
          },
          typeName: "classification"
        }
      }
    ],
    edges: [
      {
        id: "manual-classify_ticket",
        source: "manual",
        target: "classify_ticket"
      }
    ]
  }
];

export function EditorShell() {
  const [workflows, setWorkflows] = useState(INITIAL_WORKFLOWS);
  const [activeWorkflowId, setActiveWorkflowId] = useState(INITIAL_WORKFLOWS[0]?.id ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("fetch_status");
  const [lastAction, setLastAction] = useState("Foundation scaffold loaded");

  const activeWorkflow =
    workflows.find((workflow) => workflow.id === activeWorkflowId) ?? workflows[0];
  const selectedNode =
    activeWorkflow?.nodes.find((node) => node.id === selectedNodeId) ?? null;

  const updateActiveWorkflow = (
    updater: (workflow: WorkflowDraft) => WorkflowDraft
  ) => {
    setWorkflows((current) =>
      current.map((workflow) =>
        workflow.id === activeWorkflowId ? updater(workflow) : workflow
      )
    );
  };

  const handleNodesChange = (changes: NodeChange<CanvasNode>[]) => {
    updateActiveWorkflow((workflow) => ({
      ...workflow,
      nodes: applyNodeChanges(changes, workflow.nodes)
    }));
  };

  const handleEdgesChange = (changes: EdgeChange<Edge>[]) => {
    updateActiveWorkflow((workflow) => ({
      ...workflow,
      edges: applyEdgeChanges(changes, workflow.edges)
    }));
  };

  const handleConnect = (connection: Connection) => {
    updateActiveWorkflow((workflow) => ({
      ...workflow,
      edges: addEdge({ ...connection, animated: true }, workflow.edges)
    }));
    setLastAction("Connected nodes on the canvas");
  };

  const handleSelectWorkflow = (workflowId: string) => {
    setActiveWorkflowId(workflowId);
    setSelectedNodeId(null);
    setLastAction(`Opened workflow ${workflowId}`);
  };

  const handleCreateWorkflow = () => {
    const createdAt = workflows.length + 1;
    const workflow: WorkflowDraft = {
      id: `draft-${createdAt}`,
      name: `draft-${createdAt}`,
      description: "A new local-first workflow scaffold.",
      nodes: [
        {
          id: "new-trigger",
          type: "input",
          position: { x: 120, y: 180 },
          data: {
            label: "Manual Trigger",
            note: "Start here and connect downstream steps.",
            params: {},
            typeName: "manual"
          }
        }
      ],
      edges: []
    };

    setWorkflows((current) => [...current, workflow]);
    setActiveWorkflowId(workflow.id);
    setSelectedNodeId("new-trigger");
    setLastAction(`Created workflow ${workflow.name}`);
  };

  const handleLabelChange = (label: string) => {
    if (!selectedNodeId) {
      return;
    }

    updateActiveWorkflow((workflow) => ({
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                label
              }
            }
          : node
      )
    }));
    setLastAction(`Updated label for ${selectedNodeId}`);
  };

  const yamlPreview = activeWorkflow ? createWorkflowYaml(activeWorkflow) : "";

  return (
    <main className="min-h-screen px-5 py-6 text-ink lg:px-8">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
        <TopBar
          activeWorkflowName={activeWorkflow?.name ?? "No workflow"}
          lastAction={lastAction}
          onRun={() =>
            setLastAction(
              `Manual run requested for ${activeWorkflow?.name ?? "unknown workflow"}`
            )
          }
          onSave={() =>
            setLastAction(
              `Generated YAML preview for ${activeWorkflow?.name ?? "unknown workflow"}`
            )
          }
        />

        <section className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
          <WorkflowExplorer
            activeWorkflowId={activeWorkflowId}
            onCreateWorkflow={handleCreateWorkflow}
            onSelectWorkflow={handleSelectWorkflow}
            workflows={workflows}
          />

          <div className="panel-surface min-h-[720px] overflow-hidden">
            <div className="flex items-center justify-between border-b border-black/10 px-6 py-4">
              <div>
                <p className="section-kicker">Canvas</p>
                <h2 className="section-title">
                  {activeWorkflow?.name ?? "Untitled workflow"}
                </h2>
              </div>
              <div className="rounded-full bg-ember/15 px-3 py-1 text-xs font-semibold text-ember">
                YAML remains the source of truth
              </div>
            </div>

            <div className="h-[640px]">
              <ReactFlowProvider>
                <ReactFlow
                  fitView
                  nodes={activeWorkflow?.nodes ?? []}
                  edges={activeWorkflow?.edges ?? []}
                  onNodesChange={handleNodesChange}
                  onEdgesChange={handleEdgesChange}
                  onConnect={handleConnect}
                  onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                  onPaneClick={() => setSelectedNodeId(null)}
                >
                  <MiniMap
                    pannable
                    zoomable
                    className="!rounded-2xl !border !border-black/10 !bg-white/80"
                  />
                  <Controls className="!rounded-2xl !border !border-black/10 !bg-white/80" />
                  <Background
                    color="#b5c3c5"
                    gap={20}
                    size={1}
                    variant={BackgroundVariant.Dots}
                  />
                </ReactFlow>
              </ReactFlowProvider>
            </div>
          </div>

          <NodeInspector
            selectedNode={selectedNode}
            workflowDescription={activeWorkflow?.description ?? ""}
            workflowYaml={yamlPreview}
            onLabelChange={handleLabelChange}
          />
        </section>
      </div>
    </main>
  );
}

function createWorkflowYaml(workflow: WorkflowDraft) {
  const triggerNode =
    workflow.nodes.find((node) => node.type === "input") ?? workflow.nodes[0];
  const outgoingEdges = workflow.edges.reduce<Record<string, string[]>>(
    (accumulator, edge) => {
      const targets = accumulator[edge.source] ?? [];
      targets.push(edge.target);
      accumulator[edge.source] = targets;
      return accumulator;
    },
    {}
  );

  const steps = workflow.nodes
    .filter((node) => node.id !== triggerNode?.id)
    .map((node) => ({
      id: node.id,
      type: node.data.typeName,
      params: node.data.params,
      next: outgoingEdges[node.id] ?? []
    }));

  return YAML.stringify({
    version: "v1",
    name: workflow.name,
    trigger: {
      type: triggerNode?.data.typeName ?? "manual",
      ...(triggerNode?.data.params ?? {})
    },
    steps
  });
}
