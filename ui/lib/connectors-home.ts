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

import type { StarterConnectorPack } from "./starter-connector-packs";

type StarterConnectorPackInstallPriority = 0 | 1 | 2;

export type StarterConnectorPacksEmptyState =
  | "empty"
  | "no_installed_packs"
  | "ready";

export function starterConnectorPackCtaLabel(
  pack: StarterConnectorPack
): "Install" | "Installed" | "Open" {
  if (!pack.installed) {
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
  if (!pack.installed) {
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

  return packs.some((pack) => pack.installed)
    ? "ready"
    : "no_installed_packs";
}

function starterConnectorPackInstallPriority(
  pack: StarterConnectorPack
): StarterConnectorPackInstallPriority {
  if (!pack.installed) {
    return 2;
  }

  return pack.install_state === "satisfied" ? 1 : 0;
}

function starterConnectorPackInstallStateLabel(
  pack: StarterConnectorPack
): string {
  switch (pack.install_state) {
    case "satisfied":
      return "Installed";
    case "available":
      return "Not installed";
    case "invalid":
      return "Installed, needs attention";
    case "runtime_restricted":
      return "Installed, runtime restricted";
    case "setup_required":
      return "Installed, setup required";
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
