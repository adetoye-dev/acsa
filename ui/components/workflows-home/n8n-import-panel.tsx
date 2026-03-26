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

import { useRef, useState, type ChangeEvent } from "react";

import { fetchEngineJson } from "../../lib/engine-client";
import {
  importHasOpenableDraft,
  type N8nImportReportItem,
  type N8nImportRequirementItem,
  type N8nImportResponse
} from "../../lib/n8n-import";

type N8nImportPanelProps = {
  onClose: () => void;
  onOpenDraft: (response: N8nImportResponse) => void;
};

export function N8nImportPanel({
  onClose,
  onOpenDraft
}: N8nImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [jsonInput, setJsonInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<N8nImportResponse | null>(null);

  async function handleTranslate() {
    setIsImporting(true);
    setError(null);
    setResult(null);

    try {
      const workflowJson = JSON.parse(jsonInput);
      const response = await fetchEngineJson<N8nImportResponse>("/api/imports/n8n", {
        body: JSON.stringify({ workflow_json: workflowJson }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      setResult(response);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to translate n8n workflow JSON"
      );
    } finally {
      setIsImporting(false);
    }
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const nextText = await file.text();
    setJsonInput(nextText);
    setError(null);
    setResult(null);
    event.currentTarget.value = "";
  }

  return (
    <section className="border-b border-black/10 bg-[#fbfbfa] px-5 py-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="section-kicker">Migration</p>
              <h2 className="mt-1 text-sm font-semibold text-[#101a1d]">
                Import from n8n JSON
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="ui-button"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                Upload file
              </button>
              <button className="ui-button" onClick={onClose} type="button">
                Close
              </button>
            </div>
          </div>

          <p className="text-sm leading-6 text-[#5f6870]">
            Paste an exported n8n workflow JSON. Acsa will translate the supported
            subset, call out degraded pieces, and only let you open a draft when the
            result is editable.
          </p>

          <input
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => void handleFileSelection(event)}
            ref={fileInputRef}
            type="file"
          />

          <textarea
            aria-label="n8n workflow JSON input"
            className="min-h-[260px] w-full resize-y rounded-[12px] border border-black/10 bg-white px-4 py-3 font-mono text-[13px] leading-6 text-[#182232] outline-none transition placeholder:text-[#7a828b] focus:border-[#6f63ff]/45"
            onChange={(event) => setJsonInput(event.target.value)}
            placeholder={`{
  "name": "My n8n workflow",
  "nodes": [],
  "connections": {}
}`}
            spellCheck={false}
            value={jsonInput}
          />

          <div className="flex items-center gap-2">
            <button
              className="ui-button ui-button-primary"
              disabled={isImporting || !jsonInput.trim()}
              onClick={() => void handleTranslate()}
              type="button"
            >
              {isImporting ? "Translating…" : "Translate"}
            </button>

            {importHasOpenableDraft(result) ? (
              <button
                className="ui-button"
                onClick={() => result && onOpenDraft(result)}
                type="button"
              >
                Open draft
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="text-sm leading-6 text-[#c65a72]">{error}</p>
          ) : null}
        </div>

        <aside className="min-w-0 border-l border-black/10 pl-4">
          {result ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="section-kicker">Translation report</p>
                <h3 className="text-sm font-semibold text-[#101a1d]">
                  {result.workflow_name}
                </h3>
                <p className="text-sm leading-6 text-[#5f6870]">
                  {importHasOpenableDraft(result)
                    ? "This import can open as a local draft."
                    : "This import is blocked until the issues below are resolved."}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="ui-badge">{result.report.translated.length} translated</span>
                <span className="ui-badge">{result.report.degraded.length} degraded</span>
                <span className="ui-badge">{result.report.blocked.length} blocked</span>
                <span className="ui-badge">{result.report.requirements.length} follow-ups</span>
              </div>

              <ReportList
                emptyCopy="Nothing blocked."
                items={result.report.blocked}
                title="Blocked"
                tone="text-[#c65a72]"
              />
              <ReportList
                emptyCopy="Nothing degraded."
                items={result.report.degraded}
                title="Degraded"
                tone="text-[#9a6a2b]"
              />
              <RequirementList items={result.report.requirements} />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="section-kicker">Translation report</p>
              <p className="text-sm leading-6 text-[#5f6870]">
                Translate first to see what Acsa can import exactly, what needs manual
                follow-up, and whether the result can open as a draft.
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function ReportList({
  emptyCopy,
  items,
  title,
  tone
}: {
  emptyCopy: string;
  items: N8nImportReportItem[];
  title: string;
  tone: string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className={`text-xs font-semibold uppercase tracking-[0.16em] ${tone}`}>
          {title}
        </h4>
        <span className="ui-meta">{items.length}</span>
      </div>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li className="rounded-[10px] border border-black/10 bg-white px-3 py-2" key={`${item.item_name}-${index}`}>
              <p className="text-[12px] font-semibold text-[#101a1d]">
                {item.item_name}
              </p>
              <p className="mt-1 text-sm leading-6 text-[#5f6870]">{item.message}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-6 text-[#7a828b]">{emptyCopy}</p>
      )}
    </section>
  );
}

function RequirementList({
  items
}: {
  items: N8nImportRequirementItem[];
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#4f5964]">
          Follow-up
        </h4>
        <span className="ui-meta">{items.length}</span>
      </div>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li className="rounded-[10px] border border-black/10 bg-white px-3 py-2" key={`${item.requirement_type}-${index}`}>
              <p className="text-sm leading-6 text-[#5f6870]">{item.message}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-6 text-[#7a828b]">No follow-up required.</p>
      )}
    </section>
  );
}
