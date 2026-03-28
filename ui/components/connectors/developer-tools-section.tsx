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

import type { ReactNode } from "react";
import { useId, useState } from "react";

type DeveloperToolsSectionProps = {
  children: ReactNode;
};

export function DeveloperToolsSection({
  children
}: DeveloperToolsSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const buttonId = useId();

  return (
    <section className="overflow-hidden bg-white">
      <div className="px-5 pt-4">
        <h2 className="section-title mt-2">Local connector development</h2>
      </div>
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        aria-labelledby={buttonId}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="section-kicker" id={buttonId}>Developer tools</span>
        <span className="ui-badge">{isOpen ? "Hide" : "Open"}</span>
      </button>

      {isOpen ? (
        <div className="border-t border-black/10 px-5 py-4" id={panelId}>{children}</div>
      ) : (
        <div
          className="border-t border-black/10 px-5 py-4 text-sm leading-6 text-[#6b7380]"
          id={panelId}
        >
          Scaffold connectors, refresh inventory, and run sample payloads when you need low-level local tooling.
        </div>
      )}
    </section>
  );
}
