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

import Link from "next/link";

const highlights = [
  "Build and run automations from the app.",
  "Keep credentials, connectors, and executions in one place.",
  "Drop into source only when you want extra control."
] as const;

export function LandingPage() {
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

      <main className="mx-auto grid min-h-[calc(100vh-69px)] max-w-[1180px] items-center gap-12 px-6 py-12 xl:grid-cols-[minmax(0,1fr)_520px]">
        <section className="max-w-[620px]">
          <div className="mb-4 inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate/70">
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

              <div className="relative overflow-hidden p-6">
                <div className="absolute left-[56px] top-[88px]">
                  <LandingCanvasNode title="Webhook" />
                </div>
                <div className="absolute left-[248px] top-[88px]">
                  <LandingCanvasNode title="Normalize payload" />
                </div>
                <div className="absolute left-[248px] top-[236px]">
                  <LandingCanvasNode title="Approval" />
                </div>
                <div className="absolute left-[430px] top-[88px]">
                  <LandingCanvasNode title="Send Slack message" />
                </div>
                <div className="absolute left-[154px] top-[132px] h-[2px] w-[102px] bg-[#d9dce2]" />
                <div className="absolute left-[346px] top-[132px] h-[2px] w-[92px] bg-[#d9dce2]" />
                <div className="absolute left-[300px] top-[178px] h-[58px] w-[2px] bg-[#d9dce2]" />
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
