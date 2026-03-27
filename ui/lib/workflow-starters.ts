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
    description: "Collect AI news, draft a concise brief, and deliver it by email.",
    id: "ai-news-intelligence-demo",
    name: "Send an AI news brief",
    requiredStepTypes: [
      "ai_news_collector",
      "ai_news_brief_renderer",
      "smtp_email_delivery"
    ],
    yamlPath: "/starter-workflows/ai-news-intelligence-demo.yaml"
  },
  {
    description: "Capture a request, route it for approval, and finish with a clear decision.",
    id: "approval-flow-demo",
    name: "Route a request for approval",
    requiredStepTypes: [],
    yamlPath: "/starter-workflows/approval-flow-demo.yaml"
  },
  {
    description: "Receive inbound webhook events, sort them, and continue down the right path.",
    id: "webhook-intake-demo",
    name: "Receive and triage webhook events",
    requiredStepTypes: [],
    yamlPath: "/starter-workflows/webhook-intake-demo.yaml"
  }
];
