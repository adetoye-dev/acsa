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

"use client";

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import {
  RunSummary,
  type HumanTask,
  type InvalidWorkflowFile,
  type StepTypeEntry,
  type TriggerTypeEntry,
  type WorkflowDocument,
  type WorkflowSummary,
  TRIGGER_NODE_ID
} from "./workflow-editor";

type Updater<T> = T | ((current: T) => T);

type WorkflowState = {
  activeWorkflowId: string | null;
  documents: Record<string, WorkflowDocument>;
  globalError: string | null;
  inspectorError: string | null;
  invalidFiles: InvalidWorkflowFile[];
  isBooting: boolean;
  isLoadingWorkflow: boolean;
  isRefreshingTasks: boolean;
  isRunning: boolean;
  isSaving: boolean;
  lastAction: string;
  lastRun: RunSummary | null;
  newStepType: string;
  pendingTasks: HumanTask[];
  runStatus: string | null;
  selectedNodeId: string | null;
  stepCatalog: StepTypeEntry[];
  stepParamsDraft: string;
  taskValues: Record<string, string>;
  triggerCatalog: TriggerTypeEntry[];
  triggerDetailsDraft: string;
  workflows: WorkflowSummary[];
};

type WorkflowActions = {
  clearTaskValue: (taskId: string) => void;
  patch: (partial: Partial<WorkflowState>) => void;
  setDocuments: (next: Updater<Record<string, WorkflowDocument>>) => void;
  setTaskValue: (taskId: string, value: string) => void;
  setWorkflows: (next: Updater<WorkflowSummary[]>) => void;
};

type WorkflowStore = WorkflowState & WorkflowActions;

const initialWorkflowState: WorkflowState = {
  activeWorkflowId: null,
  documents: {},
  globalError: null,
  inspectorError: null,
  invalidFiles: [],
  isBooting: true,
  isLoadingWorkflow: false,
  isRefreshingTasks: false,
  isRunning: false,
  isSaving: false,
  lastAction: "Loading workflow inventory",
  lastRun: null,
  newStepType: "noop",
  pendingTasks: [],
  runStatus: null,
  selectedNodeId: TRIGGER_NODE_ID,
  stepCatalog: [],
  stepParamsDraft: "{}",
  taskValues: {},
  triggerCatalog: [],
  triggerDetailsDraft: "{}",
  workflows: []
};

function resolveUpdater<T>(next: Updater<T>, current: T) {
  return typeof next === "function" ? (next as (value: T) => T)(current) : next;
}

export const useWorkflowStore = create<WorkflowStore>()((set) => ({
  ...initialWorkflowState,
  clearTaskValue: (taskId) =>
    set((state) => {
      if (!(taskId in state.taskValues)) {
        return state;
      }

      const taskValues = { ...state.taskValues };
      delete taskValues[taskId];
      return { taskValues };
    }),
  patch: (partial) => set(partial),
  setDocuments: (next) =>
    set((state) => ({
      documents: resolveUpdater(next, state.documents)
    })),
  setTaskValue: (taskId, value) =>
    set((state) => ({
      taskValues: {
        ...state.taskValues,
        [taskId]: value
      }
    })),
  setWorkflows: (next) =>
    set((state) => ({
      workflows: resolveUpdater(next, state.workflows)
    }))
}));

export function useWorkflowActions() {
  return useWorkflowStore(
    useShallow((state) => ({
      clearTaskValue: state.clearTaskValue,
      patch: state.patch,
      setDocuments: state.setDocuments,
      setTaskValue: state.setTaskValue,
      setWorkflows: state.setWorkflows
    }))
  );
}

export function workflowStoreState() {
  return useWorkflowStore.getState();
}
