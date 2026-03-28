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

"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";

const highlights = [
  "Build and run automations from the app.",
  "Keep credentials, connectors, and executions in one place.",
  "Drop into source only when you want extra control."
] as const;

type ConnectorLine = {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

export function LandingPage() {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [lines, setLines] = useState<ConnectorLine[]>([]);

  useLayoutEffect(() => {
    function centerForKey(key: string, canvasRect: DOMRect) {
      const node = nodeRefs.current[key];
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        x: ((rect.left + rect.width / 2 - canvasRect.left) / canvasRect.width) * 100,
        y: ((rect.top + rect.height / 2 - canvasRect.top) / canvasRect.height) * 100,
      };
    }

    function recalculateLines() {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const canvasRect = canvas.getBoundingClientRect();
      const webhook = centerForKey("webhook", canvasRect);
      const normalize = centerForKey("normalize", canvasRect);
      const slack = centerForKey("slack", canvasRect);
      const approval = centerForKey("approval", canvasRect);
      if (!webhook || !normalize || !slack || !approval) {
        return;
      }

      setLines([
        { x1: webhook.x, y1: webhook.y, x2: normalize.x, y2: normalize.y },
        { x1: normalize.x, y1: normalize.y, x2: slack.x, y2: slack.y },
        { x1: normalize.x, y1: normalize.y, x2: approval.x, y2: approval.y },
      ]);
    }

    const observer = new ResizeObserver(() => recalculateLines());
    if (canvasRef.current) {
      observer.observe(canvasRef.current);
    }
    Object.values(nodeRefs.current).forEach((node) => {
      if (node) {
        observer.observe(node);
      }
    });
    recalculateLines();
    window.addEventListener("resize", recalculateLines);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recalculateLines);
    };
  }, []);

  function setNodeRef(key: string) {
    return (element: HTMLDivElement | null) => {
      nodeRefs.current[key] = element;
    };
  }

  return (
    <div className="min-h-screen bg-[#f5f6f7] text-[#101414]">
      <header className="border-b border-black/8 bg-white/88 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1180px] items-center justify-between px-6">
          <Link className="flex items-center gap-3" href="/">
            <img alt="Acsa" className="h-11 w-11" src="/acsa-mark.svg" />
            <div>
              <div className="text-sm font-semibold tracking-tight text-ink">Acsa</div>
              <div className="text-[11px] text-slate">Automation studio</div>
            </div>
          </Link>

          <Link className="ui-button ui-button-primary" href="/workflows">
            Open app
          </Link>
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-68px)] max-w-[1180px] items-center gap-12 px-6 py-12 xl:grid-cols-[minmax(0,1fr)_520px]">
        <section className="max-w-[620px]">
          <div className="mb-4 inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1 text-sm font-semibold uppercase tracking-[0.16em] text-slate/70">
            Full automation app
          </div>
          <h1 className="max-w-[11ch] text-[58px] font-semibold tracking-[-0.055em] text-[#101414]">
            Build automations in the app, not around it.
          </h1>
          <p className="mt-5 max-w-[52ch] text-[17px] leading-8 text-slate">
            Acsa gives regular users a complete automation experience in the browser, while keeping the extra source-level power available when developers want it.
          </p>

          <div className="mt-8">
            <Link className="ui-button ui-button-primary !px-5 !py-3" href="/workflows">
              Open app
            </Link>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {highlights.map((item) => (
              <div
                className="rounded-[18px] border border-black/10 bg-white px-4 py-4 text-sm leading-6 text-slate"
                key={item}
              >
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-[26px] border border-black/10 bg-white shadow-[0_20px_60px_rgba(16,20,20,0.08)]">
          <div className="grid grid-cols-[220px_minmax(0,1fr)]">
            <div className="border-r border-black/10 bg-[#fcfcfd] px-4 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/58">
                Nodes
              </div>
              <div className="mt-4 space-y-2">
                <LandingNodeItem label="Webhook" meta="Trigger workflow via HTTP" />
                <LandingNodeItem label="Schedule" meta="Run on a schedule" />
                <LandingNodeItem label="HTTP Request" meta="Call an API" />
                <LandingNodeItem label="Send Email" meta="Deliver a message" />
                <LandingNodeItem label="Approval" meta="Pause for a decision" />
              </div>
            </div>

            <div className="grid min-h-[430px] grid-rows-[60px_minmax(0,1fr)] bg-[radial-gradient(circle_at_top,#ffffff_0%,#f7f7fb_70%)]">
              <div className="flex items-center justify-between border-b border-black/10 px-5">
                <div className="text-[14px] font-medium tracking-tight text-ink">Workflow studio</div>
                <div className="rounded-full bg-[#f3f0ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f63ff]">
                  Editor
                </div>
              </div>

              <div className="relative overflow-hidden p-6" ref={canvasRef}>
                <svg
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 100"
                >
                  {lines.map((line, index) => (
                    <line
                      key={`${line.x1}-${line.y1}-${line.x2}-${line.y2}-${index}`}
                      stroke="#d9dce2"
                      strokeWidth="0.5"
                      x1={line.x1}
                      x2={line.x2}
                      y1={line.y1}
                      y2={line.y2}
                    />
                  ))}
                </svg>

                <div className="grid h-full min-h-[300px] grid-cols-3 grid-rows-2 place-items-center gap-x-4 gap-y-8">
                  <div className="col-start-1 row-start-1" ref={setNodeRef("webhook")}>
                    <LandingCanvasNode title="Webhook" />
                  </div>
                  <div className="col-start-2 row-start-1" ref={setNodeRef("normalize")}>
                    <LandingCanvasNode title="Normalize payload" />
                  </div>
                  <div className="col-start-3 row-start-1" ref={setNodeRef("slack")}>
                    <LandingCanvasNode title="Send Slack message" />
                  </div>
                  <div className="col-start-2 row-start-2" ref={setNodeRef("approval")}>
                    <LandingCanvasNode title="Approval" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function LandingNodeItem({ label, meta }: { label: string; meta: string }) {
  return (
    <div className="rounded-[14px] border border-black/10 bg-white px-3 py-3">
      <div className="text-sm font-medium tracking-tight text-ink">{label}</div>
      <div className="mt-1 text-[12px] leading-5 text-slate">{meta}</div>
    </div>
  );
}

function LandingCanvasNode({ title }: { title: string }) {
  return (
    <div className="flex h-[96px] w-[132px] flex-col items-center justify-center rounded-[22px] border border-black/10 bg-white shadow-[0_6px_20px_rgba(16,20,20,0.05)]">
      <div className="mb-2 h-10 w-10 rounded-[14px] bg-[#f4f6f8]" />
      <div className="px-3 text-center text-[13px] font-medium tracking-tight text-ink">{title}</div>
    </div>
  );
}
