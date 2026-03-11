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

import { ENGINE_PROXY_BASE } from "./workflow-editor";

export async function fetchEngineJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${ENGINE_PROXY_BASE}${path}`, {
    cache: "no-store",
    ...init
  });
  const body = await response.text();
  if (!body.trim()) {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    throw new Error(`Expected JSON response body but received empty response (status ${response.status})`);
  }

  let parsed: { error?: string } & T;
  try {
    parsed = JSON.parse(body) as { error?: string } & T;
  } catch {
    throw new Error(
      `Failed to parse JSON response (status ${response.status}): ${body}`
    );
  }

  if (!response.ok) {
    throw new Error(
      parsed && typeof parsed === "object" && typeof parsed.error === "string"
        ? parsed.error
        : `Request failed with status ${response.status}`
    );
  }

  return parsed as T;
}

export async function fetchEngineText(
  path: string,
  init?: RequestInit
): Promise<string> {
  const response = await fetch(`${ENGINE_PROXY_BASE}${path}`, {
    cache: "no-store",
    ...init
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(body || `Request failed with status ${response.status}`);
  }
  return body;
}

export async function fetchEngineNoContent(
  path: string,
  init?: RequestInit
): Promise<void> {
  const response = await fetch(`${ENGINE_PROXY_BASE}${path}`, {
    cache: "no-store",
    ...init
  });

  if (!response.ok) {
    const body = await response.text();
    let parsed: { error?: string } | undefined;
    if (body.trim()) {
      try {
        parsed = JSON.parse(body) as { error?: string };
      } catch {
        parsed = undefined;
      }
    }
    throw new Error(
      parsed && typeof parsed.error === "string"
        ? parsed.error
        : body.trim() || `Request failed with status ${response.status}`
    );
  }
}
