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

type ConnectorPackRowProps = {
  actionDisabled?: boolean;
  actionLabel?: string;
  actionTone?: "default" | "primary";
  description: string;
  helperText?: string | null;
  metadata?: string[];
  onAction?: () => void;
  statusLabel?: string;
  title: string;
};

export function ConnectorPackRow({
  actionDisabled = false,
  actionLabel,
  actionTone = "default",
  description,
  helperText,
  metadata = [],
  onAction,
  statusLabel,
  title
}: ConnectorPackRowProps) {
  return (
    <article className="rounded-[12px] border border-black/10 bg-white/90 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-[#101a1d]">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-[#5b6470]">{description}</p>
        </div>

        {actionLabel ? (
          <button
            className={`ui-button shrink-0 ${actionTone === "primary" ? "ui-button-primary" : ""}`}
            disabled={actionDisabled || !onAction}
            onClick={onAction}
            type="button"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>

      {statusLabel || metadata.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-5 text-[#6b7380]">
          {statusLabel ? (
            <span className="font-medium text-[#1b2530]">{statusLabel}</span>
          ) : null}
          {metadata.map((item, idx) => (
            <span key={`${item}-${idx}`}>{item}</span>
          ))}
        </div>
      ) : null}

      {helperText ? (
        <p className="mt-3 text-[12px] leading-5 text-[#727b87]">{helperText}</p>
      ) : null}
    </article>
  );
}
