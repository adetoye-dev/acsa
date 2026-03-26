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

const featureCards = [
  {
    title: "Start visually",
    body: "Pick a trigger, add logic, send to Slack, email, or APIs, and see the whole workflow at a glance."
  },
  {
    title: "Keep credentials in the product",
    body: "Store API keys and secrets once, then reuse them across workflows and installed connector packs."
  },
  {
    title: "Debug from the graph",
    body: "Runs stay graph-first, with payloads and logs in the rail, so fixing a failed automation feels obvious."
  }
] as const;

const howItWorks = [
  {
    title: "Choose a trigger",
    body: "Start from a webhook, schedule, manual run, or imported n8n flow."
  },
  {
    title: "Add useful steps",
    body: "Branch, transform data, call APIs, and send updates through installed packs."
  },
  {
    title: "Run and inspect",
    body: "Open executions, see what path ran, and inspect step input, output, and logs."
  }
] as const;

const integrationPills = ["Slack", "GitHub", "Google Sheets", "Email", "Webhooks", "HTTP APIs"] as const;

const valueProps = [
  "Import n8n JSON and translate it into editable Acsa workflows.",
  "Install curated connector packs and manage readiness from the app.",
  "Give regular users a complete product without taking power away from developers."
] as const;

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#f5f6f7] text-[#101414]">
      <header className="border-b border-black/8 bg-white/82 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1240px] items-center justify-between px-6">
          <Link className="flex items-center gap-3" href="/">
            <img alt="Acsa" className="h-11 w-11" src="/acsa-mark.svg" />
            <div>
              <div className="text-sm font-semibold tracking-tight text-ink">Acsa</div>
              <div className="text-[11px] text-[#6f7782]">
                Automation for users, superpowers for developers
              </div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Link className="ui-button" href="/connectors">
              Connectors
            </Link>
            <Link className="ui-button" href="/credentials">
              Credentials
            </Link>
            <Link className="ui-button ui-button-primary" href="/workflows">
              Open app
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-black/8">
          <div className="mx-auto grid max-w-[1240px] gap-10 px-6 py-16 xl:grid-cols-[minmax(0,1fr)_560px]">
            <div className="max-w-[640px]">
              <div className="mb-4 inline-flex items-center rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#666f79]">
                Local-first automation platform
              </div>
              <h1 className="max-w-[12ch] text-[54px] font-semibold tracking-[-0.05em] text-[#101414]">
                Build automations fast. Keep the source.
              </h1>
              <p className="mt-5 max-w-[58ch] text-[17px] leading-8 text-[#5f6870]">
                Build automations the normal way in the UI, then keep the extra advantages of
                local ownership, imports, editable source, and inspectable connector packs when you need them.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link className="ui-button ui-button-primary" href="/workflows">
                  Start building
                </Link>
                <Link className="ui-button" href="/workflows">
                  Import n8n
                </Link>
                <Link className="ui-button" href="/executions">
                  See executions
                </Link>
              </div>

              <div className="mt-8 flex flex-wrap gap-2">
                {integrationPills.map((item) => (
                  <span
                    className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] font-medium text-[#5f6870]"
                    key={item}
                  >
                    {item}
                  </span>
                ))}
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {featureCards.map((item) => (
                  <article
                    className="rounded-[16px] border border-black/10 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,20,20,0.04)]"
                    key={item.title}
                  >
                    <h2 className="text-sm font-semibold text-[#11181c]">{item.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-[#5f6870]">{item.body}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-black/10 bg-white shadow-[0_20px_60px_rgba(16,20,20,0.08)]">
              <div className="grid grid-cols-[220px_minmax(0,1fr)_220px]">
                <div className="border-r border-black/10 bg-[#fafafa] p-4">
                  <p className="section-kicker">Packs</p>
                  <div className="mt-4 space-y-2">
                    <LandingRailItem active label="Slack alerts" meta="Ready" />
                    <LandingRailItem label="GitHub triage" meta="Setup required" />
                    <LandingRailItem label="Email delivery" meta="Configured" />
                  </div>
                </div>

                <div className="min-h-[420px] border-r border-black/10 bg-[radial-gradient(circle_at_top,#ffffff_0%,#f7f7fb_70%)] p-6">
                  <p className="section-kicker">Workflow</p>
                  <div className="relative mt-8 h-[320px] rounded-[18px] border border-black/8 bg-white/78">
                    <CanvasNode className="left-8 top-14" icon="Trigger" title="Manual trigger" />
                    <CanvasNode className="left-[210px] top-14" icon="Transform" title="Normalize payload" />
                    <CanvasNode className="left-[210px] top-[196px]" icon="Slack" title="Post to Slack" />
                    <CanvasNode className="left-[390px] top-14" icon="Email" title="Send email" />
                    <FlowLine className="left-[130px] top-[92px] w-[90px]" />
                    <FlowLine className="left-[332px] top-[92px] w-[74px]" />
                    <FlowLine className="left-[286px] top-[144px] h-[65px] w-[2px]" vertical />
                  </div>
                </div>

                <div className="bg-[#fcfcfd] p-4">
                  <p className="section-kicker">Inspect</p>
                  <div className="mt-4 space-y-4">
                    <div className="rounded-[14px] border border-black/10 bg-white px-3 py-3">
                      <div className="text-sm font-semibold text-[#11181c]">Credentials</div>
                      <div className="mt-2 text-sm leading-6 text-[#606973]">
                        OPENAI_API_KEY
                        <br />
                        ACSA_WEBHOOK_SECRET
                      </div>
                    </div>
                    <div className="rounded-[14px] border border-black/10 bg-white px-3 py-3">
                      <div className="text-sm font-semibold text-[#11181c]">Last run</div>
                      <div className="mt-2 text-sm leading-6 text-[#606973]">
                        Graph-first inspection with payload and logs in the rail.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-black/8">
          <div className="mx-auto max-w-[1240px] px-6 py-12">
            <div className="grid gap-4 md:grid-cols-3">
              {howItWorks.map((item, index) => (
                <article
                  className="rounded-[16px] border border-black/10 bg-white px-4 py-4"
                  key={item.title}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6f63ff]">
                    Step {index + 1}
                  </div>
                  <h2 className="mt-2 text-sm font-semibold text-[#11181c]">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-[#5f6870]">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-black/8">
          <div className="mx-auto max-w-[1240px] px-6 py-14">
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div>
                <p className="section-kicker">Why Acsa</p>
                <h2 className="mt-2 text-[30px] font-semibold tracking-[-0.04em] text-[#11181c]">
                  Full automation product, not a developer-only side tool.
                </h2>
              </div>
              <div className="space-y-3">
                {valueProps.map((item) => (
                  <div
                    className="rounded-[16px] border border-black/10 bg-white px-4 py-3 text-sm leading-6 text-[#56606a]"
                    key={item}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-6 px-6 py-12">
            <div>
              <p className="section-kicker">Get started</p>
              <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.04em] text-[#11181c]">
                Open the app, import a flow, and keep the source visible.
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <Link className="ui-button" href="/connectors">
                Explore packs
              </Link>
              <Link className="ui-button ui-button-primary" href="/workflows">
                Open app
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function LandingRailItem({
  active = false,
  label,
  meta
}: {
  active?: boolean;
  label: string;
  meta: string;
}) {
  return (
    <div
      className={`rounded-[12px] border px-3 py-2 ${
        active ? "border-[#6f63ff]/30 bg-[#f5f2ff]" : "border-black/8 bg-white"
      }`}
    >
      <div className="text-sm font-medium text-[#11181c]">{label}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-[#727a84]">{meta}</div>
    </div>
  );
}

function CanvasNode({
  className,
  icon,
  title
}: {
  className: string;
  icon: string;
  title: string;
}) {
  return (
    <div className={`absolute w-[140px] rounded-[16px] border border-black/10 bg-white px-3 py-3 shadow-[0_10px_30px_rgba(16,20,20,0.05)] ${className}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6f63ff]">
        {icon}
      </div>
      <div className="mt-2 text-sm font-semibold text-[#11181c]">{title}</div>
    </div>
  );
}

function FlowLine({
  className,
  vertical = false
}: {
  className: string;
  vertical?: boolean;
}) {
  return (
    <div
      className={`absolute rounded-full bg-[#6f63ff]/55 ${vertical ? "" : "h-[2px]"} ${className}`}
    />
  );
}
