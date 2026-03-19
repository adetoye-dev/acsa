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

import { EditorShell } from "../../../../components/editor-shell";

type NewWorkflowStudioPageProps = {
  searchParams?: Promise<{
    starter?: string | string[];
  }>;
};

export default async function NewWorkflowStudioPage({
  searchParams
}: NewWorkflowStudioPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const starterId = Array.isArray(resolvedSearchParams.starter)
    ? resolvedSearchParams.starter[0] ?? null
    : resolvedSearchParams.starter ?? null;

  return (
    <EditorShell
      createDraftOnBoot
      embeddedInProductShell
      starterId={starterId}
      syncRoute
    />
  );
}
