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

import { fetchEngineJson } from "./engine-client";
import { slugifyIdentifier } from "./workflow-editor";

export type UpsertNodeRecordRequest = {
  base_type_name?: string;
  category: string;
  description: string;
  label: string;
  source_kind: string;
  source_ref?: string | null;
  type_name: string;
};

export type NodeRecordResponse = {
  base_type_name?: string | null;
  category: string;
  description: string;
  id: string;
  label: string;
  source_kind: string;
  source_ref?: string | null;
  type_name: string;
  updated_at: number;
};

export async function upsertNodeRecord(request: UpsertNodeRecordRequest) {
  return fetchEngineJson<NodeRecordResponse>("/api/node-records", {
    body: JSON.stringify(request),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });
}

export async function applyNodeAssetUpdate(typeName: string) {
  return fetchEngineJson<{
    available_version?: string | null;
    installed_version?: string | null;
    is_locally_modified: boolean;
    type_name: string;
  }>(`/api/node-records/${encodeURIComponent(typeName)}/apply-update`, {
    body: JSON.stringify({}),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });
}

export function deriveGeneratedNodeIdentity(seed: string, fallbackLabel = "Generated node") {
  const compact = seed.replace(/\s+/g, " ").trim();
  const cleaned = compact.replace(/[.?!,:;]+$/g, "");
  const label = (cleaned || fallbackLabel).slice(0, 72).trim() || fallbackLabel;
  return {
    label,
    type_name: slugifyIdentifier(label) || slugifyIdentifier(fallbackLabel) || "generated-node"
  };
}
