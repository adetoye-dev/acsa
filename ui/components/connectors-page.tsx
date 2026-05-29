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

import { useEffect, useMemo, useState } from "react";
import { 
  Sparkles, 
  FileText, 
  Database, 
  Briefcase, 
  CheckSquare, 
  MessageSquare, 
  Phone, 
  ArrowUpRight, 
  ExternalLink 
} from "lucide-react";

const SlackIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    stroke="currentColor"
    strokeWidth="2"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </svg>
);

interface MarketplaceItem {
  name: string;
  description: string;
  category: string;
  icon: any;
  color: string;
  bgColor: string;
}

export function ConnectorsPage() {
  const marketplaceItems: MarketplaceItem[] = [
    {
      name: "OpenAI",
      description: "Generate responses, extract details, and perform complex reasoning using GPT-4o models.",
      category: "AI & Inference",
      icon: Sparkles,
      color: "#10a37f",
      bgColor: "rgba(16, 163, 127, 0.08)",
    },
    {
      name: "HubSpot",
      description: "Sync contacts, create deals, trigger marketing workflows, and keep client data aligned.",
      category: "CRM & Sales",
      icon: Briefcase,
      color: "#ff7a59",
      bgColor: "rgba(255, 122, 89, 0.08)",
    },
    {
      name: "Notion",
      description: "Read, write, append databases, and create structured documentation pages dynamically.",
      category: "Workspace",
      icon: FileText,
      color: "#000000",
      bgColor: "rgba(0, 0, 0, 0.04)",
    },
    {
      name: "Linear",
      description: "File technical issues, transition ticket states, and keep product sprints running smoothly.",
      category: "Product & Engineering",
      icon: CheckSquare,
      color: "#5e6ad2",
      bgColor: "rgba(94, 106, 210, 0.08)",
    },
    {
      name: "Salesforce",
      description: "Query enterprise accounts, sync live pipeline changes, and trigger customer alerts.",
      category: "CRM & Sales",
      icon: Database,
      color: "#00a1e0",
      bgColor: "rgba(0, 161, 224, 0.08)",
    },
    {
      name: "Discord",
      description: "Send enriched markdown webhooks, manage user notifications, and sync active channels.",
      category: "Messaging",
      icon: MessageSquare,
      color: "#5865f2",
      bgColor: "rgba(88, 101, 242, 0.08)",
    },
    {
      name: "Twilio",
      description: "Transmit SMS announcements, make telephony notifications, and handle incoming call loops.",
      category: "Telephony",
      icon: Phone,
      color: "#f22f46",
      bgColor: "rgba(242, 47, 70, 0.08)",
    },
    {
      name: "Slack Advanced",
      description: "Manage channel memberships, query user profiles, and orchestrate interactive dialog panels.",
      category: "Messaging",
      icon: SlackIcon,
      color: "#4a154b",
      bgColor: "rgba(74, 21, 75, 0.08)",
    }
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fafafc]">
      <header className="flex h-[60px] items-center justify-between gap-4 border-b border-black/10 bg-white px-5">
        <div>
          <h1 className="section-title mt-2">Connectors</h1>
          <p className="mt-0.5 text-sm text-[#68707a]">Explore, search, and install modular connectors published by the community.</p>
        </div>
      </header>

      <div className="sleek-scroll min-h-0 flex-1 overflow-y-auto">
        {/* Premium Community Marketplace */}
        <section className="bg-gradient-to-b from-white to-[#fcfcfd] px-6 py-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#767b81]">Global Ecosystem</div>
              <h2 className="font-display text-xl font-bold tracking-tight text-[#101a1d] mt-1">Community Connector Marketplace</h2>
              <p className="text-sm text-[#68707a] mt-0.5">Explore ready-to-publish connectors built by the community. Easily install with one click.</p>
            </div>
            <div>
              <a 
                href="https://github.com/achsah-systems/acsa" 
                target="_blank" 
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-[12px] border border-[#6f63ff]/20 bg-[#6f63ff]/5 px-4 py-2.5 text-[12px] font-bold text-[#6f63ff] transition hover:bg-[#6f63ff]/10 hover:border-[#6f63ff]/30 shadow-sm"
              >
                <span>Submit a Connector</span>
                <ArrowUpRight size={14} />
              </a>
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {marketplaceItems.map((item) => {
              const Icon = item.icon;
              return (
                <div 
                  key={item.name}
                  className="group relative overflow-hidden rounded-[20px] border border-black/[0.06] bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(0,0,0,0.06)] hover:border-black/[0.1]"
                >
                  {/* Glassmorphic Coming Soon Ribbon Overlay */}
                  <div className="absolute top-3 right-3 z-10 rounded-[8px] bg-black/[0.04] border border-black/[0.05] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#767b81]">
                    Coming Soon
                  </div>

                  <div className="flex items-center gap-3.5 mb-4">
                    <div 
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] transition-transform duration-300 group-hover:scale-105"
                      style={{ backgroundColor: item.bgColor }}
                    >
                      <Icon size={20} style={{ color: item.color }} />
                    </div>
                    <div>
                      <h3 className="text-[15px] font-bold tracking-tight text-ink">{item.name}</h3>
                      <div className="text-[10px] font-semibold text-slate/50 uppercase tracking-wide mt-0.5">{item.category}</div>
                    </div>
                  </div>

                  <p className="text-[13px] leading-6 text-slate/75 mb-6 min-h-[48px]">
                    {item.description}
                  </p>

                  <div className="flex items-center justify-between border-t border-black/[0.04] pt-3 mt-auto">
                    <span className="text-[11px] font-semibold text-slate/40">Free Integration</span>
                    <button 
                      type="button" 
                      disabled
                      className="inline-flex items-center gap-1 text-[12px] font-bold text-[#6f63ff]/40 cursor-not-allowed"
                    >
                      <span>Install</span>
                      <ExternalLink size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
