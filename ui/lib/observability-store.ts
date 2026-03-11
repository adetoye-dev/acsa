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
  type LogPageResponse,
  type MetricsSummary,
  type RunDetailResponse,
  type RunPageResponse
} from "./observability";

type ObservabilityState = {
  isRefreshingHistory: boolean;
  logLevelFilter: string;
  logSearch: string;
  logs: LogPageResponse | null;
  metrics: MetricsSummary | null;
  runDetail: RunDetailResponse | null;
  runPage: RunPageResponse | null;
  runStatusFilter: string;
  runWorkflowFilter: string;
  selectedRunId: string | null;
};

type ObservabilityActions = {
  patch: (partial: Partial<ObservabilityState>) => void;
};

type ObservabilityStore = ObservabilityState & ObservabilityActions;

const initialObservabilityState: ObservabilityState = {
  isRefreshingHistory: false,
  logLevelFilter: "",
  logSearch: "",
  logs: null,
  metrics: null,
  runDetail: null,
  runPage: null,
  runStatusFilter: "",
  runWorkflowFilter: "",
  selectedRunId: null
};

export const useObservabilityStore = create<ObservabilityStore>()((set) => ({
  ...initialObservabilityState,
  patch: (partial) => set(partial)
}));

export function useObservabilityActions() {
  return useObservabilityStore(
    useShallow((state) => ({
      patch: state.patch
    }))
  );
}

export function observabilityStoreState() {
  return useObservabilityStore.getState();
}
