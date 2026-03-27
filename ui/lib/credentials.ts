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

import { fetchEngineJson, fetchEngineNoContent } from "./engine-client";

export type CredentialItem = {
  is_overridden_by_env: boolean;
  name: string;
  updated_at: number;
};

export type CredentialsResponse = {
  credentials: CredentialItem[];
};

export async function fetchCredentials() {
  return fetchEngineJson<CredentialsResponse>("/api/credentials");
}

export async function saveCredential(name: string, value: string): Promise<CredentialItem> {
  return await fetchEngineJson<CredentialItem>("/api/credentials", {
    body: JSON.stringify({ name, value }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

export async function removeCredential(name: string) {
  return fetchEngineNoContent(`/api/credentials/${encodeURIComponent(name)}`, {
    method: "DELETE"
  });
}
