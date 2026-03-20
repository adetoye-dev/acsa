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

import type {
  ConnectorInventoryItem,
  ConnectorInventoryResponse,
  InvalidConnector,
  StarterConnectorPackInstallState
} from "./connectors";
import type { StarterConnectorPack } from "./starter-connector-packs";

type StarterConnectorPackInstallPriority = 0 | 1 | 2;
type InstalledStarterPackPriority = 0 | 1 | 2 | 3;

export type StarterConnectorPacksEmptyState =
  | "empty"
  | "no_installed_packs"
  | "ready";

export type InstalledStarterConnectorPackRow = {
  actionLabel: "Open" | "Setup";
  description: string;
  id: string;
  installState: StarterConnectorPackInstallState;
  metadata: string[];
  name: string;
  statusLabel: string;
};

export type StarterConnectorPackRow = {
  ctaLabel: "Install" | "Installed" | "Open";
  description: string;
  helperText: string | null;
  id: string;
  installed: boolean;
  name: string;
};

export function starterConnectorPackCtaLabel(
  pack: StarterConnectorPack
): "Install" | "Installed" | "Open" {
  if (!isStarterConnectorPackInstalled(pack)) {
    return "Install";
  }

  return pack.install_state === "satisfied" ? "Open" : "Installed";
}

export function orderStarterConnectorPacks(
  packs: StarterConnectorPack[]
): StarterConnectorPack[] {
  return [...packs].sort((left, right) => {
    const priorityDelta =
      starterConnectorPackInstallPriority(left) -
      starterConnectorPackInstallPriority(right);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}

export function installedStarterConnectorPackSecondaryMetadata(
  pack: StarterConnectorPack
): string[] {
  if (!isStarterConnectorPackInstalled(pack)) {
    const stepTypesLabel = starterConnectorPackStepTypesLabel(pack);
    return stepTypesLabel ? [stepTypesLabel] : [];
  }

  const metadata = [starterConnectorPackInstallStateLabel(pack)];
  const stepTypesLabel = starterConnectorPackStepTypesLabel(pack);
  if (stepTypesLabel) {
    metadata.push(stepTypesLabel);
  }

  return metadata;
}

export function resolveStarterConnectorPacksEmptyState(
  packs: StarterConnectorPack[]
): StarterConnectorPacksEmptyState {
  if (packs.length === 0) {
    return "empty";
  }

  return packs.some((pack) => isStarterConnectorPackInstalled(pack))
    ? "ready"
    : "no_installed_packs";
}

export function buildStarterConnectorPackRows(
  packs: StarterConnectorPack[]
): StarterConnectorPackRow[] {
  return orderStarterConnectorPacks(packs).map((pack) => ({
    ctaLabel: starterConnectorPackCtaLabel(pack),
    description: pack.description,
    helperText: starterConnectorPackHelperText(pack),
    id: pack.id,
    installed: isStarterConnectorPackInstalled(pack),
    name: pack.name
  }));
}

export function buildInstalledStarterConnectorPackRows(
  packs: StarterConnectorPack[],
  inventory: ConnectorInventoryResponse | null
): InstalledStarterConnectorPackRow[] {
  if (!inventory) {
    return [];
  }

  const connectorsByStepType = new Map<
    string,
    ConnectorInventoryItem | InvalidConnector
  >();

  for (const connector of inventory.connectors) {
    for (const stepType of connector.provided_step_types) {
      connectorsByStepType.set(stepType, connector);
    }
  }

  for (const connector of inventory.invalid_connectors) {
    for (const stepType of connector.provided_step_types) {
      if (!connectorsByStepType.has(stepType)) {
        connectorsByStepType.set(stepType, connector);
      }
    }
  }

  return [...packs]
    .filter((pack) => isStarterConnectorPackInstalled(pack))
    .sort((left, right) => {
      const priorityDelta =
        installedStarterConnectorPackPriority(left.install_state) -
        installedStarterConnectorPackPriority(right.install_state);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
    })
    .map((pack) => {
      const connector = pack.provided_step_types
        .map((stepType) => connectorsByStepType.get(stepType))
        .find(Boolean);
      const metadata = [
        ...installedStarterConnectorPackSecondaryMetadata(pack),
        ...installedConnectorUsageMetadata(connector)
      ];

      return {
        actionLabel: pack.install_state === "satisfied" ? "Open" : "Setup",
        description: pack.description,
        id: pack.id,
        installState: pack.install_state,
        metadata,
        name: pack.name,
        statusLabel: starterConnectorPackInstallStateLabel(pack)
      };
    });
}

export function isStarterConnectorPackInstalled(pack: StarterConnectorPack): boolean {
  return pack.install_state !== "available";
}

function starterConnectorPackInstallPriority(
  pack: StarterConnectorPack
): StarterConnectorPackInstallPriority {
  if (!isStarterConnectorPackInstalled(pack)) {
    return 2;
  }

  return pack.install_state === "satisfied" ? 1 : 0;
}

function installedStarterConnectorPackPriority(
  installState: StarterConnectorPackInstallState
): InstalledStarterPackPriority {
  switch (installState) {
    case "invalid":
      return 0;
    case "setup_required":
      return 1;
    case "runtime_restricted":
      return 2;
    case "satisfied":
      return 3;
    case "available":
      return 3;
  }
}

function starterConnectorPackHelperText(
  pack: StarterConnectorPack
): string | null {
  switch (pack.install_state) {
    case "available":
      return "Installs a real local connector into your workspace.";
    case "setup_required":
      return "Installed locally. Finish setup before using it in workflows.";
    case "runtime_restricted":
      return "Installed locally, but runtime permissions still need attention.";
    case "invalid":
      return "Installed locally, but the connector files need attention.";
    case "satisfied":
      return "Already installed and ready to use.";
  }
}

function starterConnectorPackInstallStateLabel(
  pack: StarterConnectorPack
): string {
  switch (pack.install_state) {
    case "satisfied":
      return "Ready";
    case "available":
      return "Not installed";
    case "invalid":
      return "Invalid";
    case "runtime_restricted":
      return "Runtime restricted";
    case "setup_required":
      return "Setup required";
  }
}

function starterConnectorPackStepTypesLabel(
  pack: StarterConnectorPack
): string {
  if (pack.provided_step_types.length === 0) {
    return "";
  }

  if (pack.provided_step_types.length === 1) {
    return `Provides ${pack.provided_step_types[0]}`;
  }

  return `Provides ${pack.provided_step_types.join(", ")}`;
}

function installedConnectorUsageMetadata(
  connector: ConnectorInventoryItem | InvalidConnector | undefined
): string[] {
  if (!connector) {
    return [];
  }

  const metadata: string[] = [];
  if (connector.used_by_workflows.length > 0) {
    metadata.push(
      connector.used_by_workflows.length === 1
        ? "Used by 1 workflow"
        : `Used by ${connector.used_by_workflows.length} workflows`
    );
  }
  if (connector.required_by_templates.length > 0) {
    metadata.push(
      connector.required_by_templates.length === 1
        ? "Used by 1 starter"
        : `Used by ${connector.required_by_templates.length} starters`
    );
  }
  return metadata;
}
