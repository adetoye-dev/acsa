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

import type { StarterConnectorPackInstallState } from "./connectors";
import { fetchEngineJson } from "./engine-client";

export type StarterConnectorPack = {
  description: string;
  id: string;
  install_state: StarterConnectorPackInstallState;
  installed: boolean;
  name: string;
  provided_step_types: string[];
};

export async function fetchStarterConnectorPacks(): Promise<
  StarterConnectorPack[]
> {
  return fetchEngineJson<StarterConnectorPack[]>(
    "/api/connectors/starter-packs"
  );
}

export async function installStarterConnectorPack(
  packId: string
): Promise<StarterConnectorPack> {
  if (!packId || !packId.trim()) {
    throw new Error("packId must be provided and non-empty");
  }
  return fetchEngineJson<StarterConnectorPack>(
    `/api/connectors/starter-packs/${encodeURIComponent(packId)}/install`,
    {
      method: "POST"
    }
  );
}
