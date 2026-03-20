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

const SEMANTIC_CATEGORY_LABELS: Record<string, string> = {
  ai: "AI",
  apps: "Apps",
  core: "Core",
  data: "Data",
  flow: "Flow",
  human: "Human",
  integration: "Apps",
  trigger: "Trigger"
};

const SEMANTIC_STEP_TYPE_LABELS: Record<string, string> = {
  email_send: "Email delivery",
  github_issue_create: "GitHub issues",
  google_sheets_append_row: "Google Sheets rows",
  slack_notify: "Slack notifications"
};

export function semanticCategoryLabel(category: string): string {
  return SEMANTIC_CATEGORY_LABELS[category] ?? titleCaseWords(category);
}

export function semanticStepTypeLabel(typeName: string): string {
  return SEMANTIC_STEP_TYPE_LABELS[typeName] ?? titleCaseWords(typeName);
}

export function semanticStepTypeSummary(typeNames: string[]): string {
  const labels = typeNames.map((typeName) => semanticStepTypeLabel(typeName));
  return labels.length === 0
    ? ""
    : labels.length === 1
      ? labels[0]
      : labels.join(", ");
}

export function semanticConnectorCapabilities(typeNames: string[]): string {
  const summary = semanticStepTypeSummary(typeNames);
  return summary ? `Provides ${summary}` : "";
}

function titleCaseWords(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
