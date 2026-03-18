"use client";

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

import { ConnectorManager } from "./connector-manager";

export function ConnectorsPage() {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <header className="border-b border-black/10 bg-[rgba(255,255,255,0.72)] px-6 py-5">
        <p className="section-kicker">Connectors</p>
        <h1 className="section-title mt-2">Connector inventory</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate">
          Manage local process and WASM connectors, scaffold new runtimes, and test manifests
          outside the workflow editor.
        </p>
      </header>

      <div className="min-h-0 overflow-hidden px-6 py-6">
        <ConnectorManager onCatalogInvalidated={() => {}} />
      </div>
    </div>
  );
}
