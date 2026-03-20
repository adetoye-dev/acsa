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

export type WorkflowStarter = {
  description: string;
  id: string;
  name: string;
  requiredStepTypes: string[];
  yamlPath: string;
};

export const WORKFLOW_STARTERS: WorkflowStarter[] = [
  {
    description: "Collect AI news, draft a concise brief, and publish the result.",
    id: "ai-news-intelligence-demo",
    name: "AI News Intelligence",
    requiredStepTypes: [
      "ai_news_collector",
      "ai_news_brief_renderer",
      "smtp_email_delivery"
    ],
    yamlPath: "/starter-workflows/ai-news-intelligence-demo.yaml"
  },
  {
    description: "Seed a request, route it through approval, and finish cleanly.",
    id: "approval-flow-demo",
    name: "Approval Flow",
    requiredStepTypes: [],
    yamlPath: "/starter-workflows/approval-flow-demo.yaml"
  },
  {
    description: "Accept incoming webhook payloads and route them through a simple branch.",
    id: "webhook-intake-demo",
    name: "Webhook Intake",
    requiredStepTypes: [],
    yamlPath: "/starter-workflows/webhook-intake-demo.yaml"
  }
];
