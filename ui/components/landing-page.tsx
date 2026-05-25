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
import { Zap, Blocks, User, Box, Sparkles } from "lucide-react";

type ConnectorLine = {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

const CONNECTORS = [
  { 
    name: "Webhooks", 
    desc: "Trigger automated pipelines dynamically via incoming JSON payloads.", 
    icon: "⚡", 
    tag: "Ingestion", 
    tagColor: "bg-[#eefaf3] border-[#caecd8] text-[#2fa36b]", 
    color: "bg-gradient-to-br from-[#eefaf3] to-[#d8f4e2] text-[#2fa36b] border-[#caecd8]", 
    package: "acsa-webhook" 
  },
  { 
    name: "OpenAI LLMs", 
    desc: "Synthesize findings, analyze competitor gaps, and write custom cold drafts.", 
    icon: "🧠", 
    tag: "AI Logic", 
    tagColor: "bg-[#f3f0ff] border-[#ddd4ff] text-[#6f63ff]", 
    color: "bg-gradient-to-br from-[#f3f0ff] to-[#e7e1ff] text-[#6f63ff] border-[#ddd4ff]", 
    package: "acsa-openai" 
  },
  { 
    name: "Firecrawl", 
    desc: "Crawl and convert any website into LLM-ready clean markdown instantly.", 
    icon: "🌐", 
    tag: "Ingestion", 
    tagColor: "bg-[#eef9f7] border-[#cfe9e2] text-[#2f8f7b]", 
    color: "bg-gradient-to-br from-[#eef9f7] to-[#d8f3ec] text-[#2f8f7b] border-[#cfe9e2]", 
    package: "acsa-firecrawl" 
  },
  { 
    name: "Google Sheets", 
    desc: "Read, write, and format cells dynamically for live lead pipelines.", 
    icon: "📊", 
    tag: "Output", 
    tagColor: "bg-[#eef9f7] border-[#cfe9e2] text-[#2f8f7b]", 
    color: "bg-gradient-to-br from-[#eef9f7] to-[#d8f3ec] text-[#2f8f7b] border-[#cfe9e2]", 
    package: "acsa-gsheets" 
  },
  { 
    name: "SMTP Email", 
    desc: "Send summary notifications with tab-targeted worksheet URLs.", 
    icon: "📧", 
    tag: "Output", 
    tagColor: "bg-[#eef9f7] border-[#cfe9e2] text-[#2f8f7b]", 
    color: "bg-gradient-to-br from-[#eef9f7] to-[#d8f3ec] text-[#2f8f7b] border-[#cfe9e2]", 
    package: "acsa-smtp" 
  },
  { 
    name: "Slack Alerts", 
    desc: "Notify dedicated team channels and push real-time task updates.", 
    icon: "💬", 
    tag: "Output", 
    tagColor: "bg-[#eef9f7] border-[#cfe9e2] text-[#2f8f7b]", 
    color: "bg-gradient-to-br from-[#eef9f7] to-[#d8f3ec] text-[#2f8f7b] border-[#cfe9e2]", 
    package: "acsa-slack" 
  }
];

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
        x: rect.left + rect.width / 2 - canvasRect.left,
        y: rect.top + rect.height / 2 - canvasRect.top,
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
      const askai = centerForKey("askai", canvasRect);
      const slack = centerForKey("slack", canvasRect);
      const approval = centerForKey("approval", canvasRect);
      if (!webhook || !normalize || !askai || !slack || !approval) {
        return;
      }

      // 28px is half the width/height of the 56px rounded square.
      // This connects lines pixel-accurately to the left/right edge handles.
      setLines([
        { x1: webhook.x + 28, y1: webhook.y, x2: normalize.x - 28, y2: normalize.y },
        { x1: normalize.x + 28, y1: normalize.y, x2: askai.x - 28, y2: askai.y },
        { x1: askai.x + 28, y1: askai.y, x2: slack.x - 28, y2: slack.y },
        { x1: askai.x + 28, y1: askai.y, x2: approval.x - 28, y2: approval.y },
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

  const drawBezier = (line: ConnectorLine) => {
    const cp1x = line.x1 + (line.x2 - line.x1) * 0.45;
    const cp2x = line.x1 + (line.x2 - line.x1) * 0.55;
    return `M ${line.x1} ${line.y1} C ${cp1x} ${line.y1}, ${cp2x} ${line.y2}, ${line.x2} ${line.y2}`;
  };

  return (
    <div className="min-h-screen text-ink selection:bg-[#6f63ff]/10 relative overflow-hidden">
      
      {/* Keyframe animations injected */}
      <style dangerouslySetInnerHTML={{ __html: `
        .canvas-dot-grid {
          background-image: radial-gradient(rgba(111, 99, 255, 0.06) 1.5px, transparent 1.5px);
          background-size: 24px 24px;
        }

        @keyframes flow {
          to {
            stroke-dashoffset: -20;
          }
        }
        
        .flow-line {
          stroke-dasharray: 6, 4;
          animation: flow 1.5s linear infinite;
        }
      `}} />

      {/* Modern Premium Header matching TopBar */}
      <header className="border-b border-black/5 bg-white/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="mx-auto flex h-[60px] max-w-[1100px] items-center justify-between px-6">
          <Link className="flex items-center gap-3 transition-transform duration-200 hover:scale-[1.01]" href="/">
            <img alt="Acsa Logo" className="h-9 w-9 shrink-0 drop-shadow-sm" src="/acsa-mark.svg" />
            <div>
              <div className="text-[14px] font-bold tracking-tight text-ink">Acsa</div>
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6f63ff]/80">
                Workflow studio
              </div>
            </div>
          </Link>

          <Link 
            className="inline-flex h-8 items-center gap-1.5 rounded-[9px] px-4 text-[12.5px] font-semibold tracking-wide transition-all duration-200 bg-gradient-to-br from-[#776cff] to-[#5d52d8] text-white shadow-[0_2px_4px_rgba(111,99,255,0.2)] hover:shadow-[0_4px_8px_rgba(111,99,255,0.3)] hover:-translate-y-0.5 border border-[#5d52d8]/20" 
            href="/workflows"
          >
            Launch Studio
          </Link>
        </div>
      </header>

      {/* Centered Hero Section inspired by FireFlow layout */}
      <main className="mx-auto max-w-[1100px] px-6 py-20 text-center relative z-10 flex flex-col items-center">
        
        {/* Kicker badge */}
        <div className="mb-6 inline-flex items-center rounded-[8px] border border-black/10 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5e6772] shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          ⚡ Developer-first automation
        </div>
        
        {/* Centered Large Bold Title */}
        <h1 className="text-4xl sm:text-5xl md:text-[56px] font-extrabold tracking-tight leading-[1.1] text-ink max-w-[840px] mx-auto">
          Build automations <span className="text-[#6f63ff]">in the app</span>,<br className="hidden sm:inline" />
          not around it.
        </h1>
        
        {/* Spacious Description Subtitle */}
        <p className="mt-6 text-[15px] sm:text-[16px] leading-relaxed text-[#5c6470] max-w-[620px] mx-auto">
          Acsa gives builders a complete visual automation experience in the browser, while keeping the extra source-level power of declarative YAML available when developers want it.
        </p>

        {/* Small Metadata row */}
        <div className="mt-6 flex items-center justify-center gap-4 text-[12px] text-[#757d88] font-bold select-none uppercase tracking-wider">
          <span>◇ Open Source</span>
          <span className="text-black/10">|</span>
          <span>◇ AI-Powered</span>
          <span className="text-black/10">|</span>
          <span>◇ Git Native</span>
        </div>

        {/* Centered Action Buttons */}
        <div className="mt-8 flex flex-wrap gap-3.5 justify-center">
          <Link 
            className="inline-flex h-11 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#776cff] to-[#5d52d8] text-white font-semibold px-8 text-[13px] uppercase tracking-[0.14em] transition-all duration-200 shadow-[0_2px_4px_rgba(111,99,255,0.2)] hover:shadow-[0_4px_8px_rgba(111,99,255,0.3)] hover:-translate-y-0.5 border border-[#5d52d8]/20 cursor-pointer" 
            href="/workflows"
          >
            Launch Studio
          </Link>
          
          <a 
            href="https://github.com/adetoye-dev/acsa" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="inline-flex h-11 items-center justify-center rounded-[10px] border border-black/10 bg-white text-[#1c242c] font-semibold px-6 text-[13px] uppercase tracking-[0.14em] hover:border-black/20 hover:bg-[#fafaf8] transition-all duration-200 shadow-sm"
          >
            Star on GitHub
          </a>
        </div>

        {/* Spacious horizontal visual canvas builder illustration */}
        <div className="w-full mt-16 max-w-[1000px] h-[280px] relative" style={{ contentVisibility: 'auto' }}>
          {/* Subtle canvas dot grid borderless background */}
          <div className="absolute inset-0 canvas-dot-grid pointer-events-none rounded-[16px] border border-black/5 bg-[#fcfcfd]/20" />
          
          <div className="w-full h-full relative" ref={canvasRef}>
            
            {/* Animated Bezier Curved Connection Lines */}
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              {lines.map((line, index) => (
                <path
                  key={`${line.x1}-${line.y1}-${line.x2}-${line.y2}-${index}`}
                  className="flow-line fill-none"
                  stroke="rgba(111, 99, 255, 0.45)"
                  strokeWidth="2"
                  d={drawBezier(line)}
                />
              ))}
            </svg>

            {/* Node 1: Webhook (Trigger) */}
            <div 
              className="absolute -translate-x-1/2 -translate-y-1/2" 
              style={{ left: "10%", top: "50%" }}
            >
              <LandingCanvasNode 
                innerRef={setNodeRef("webhook")}
                title="Webhook" 
                subtitle="http_webhook"
                icon={<Zap size={18} strokeWidth={1.8} />}
                familyClass="bg-gradient-to-br from-[#eefaf3] to-[#d8f4e2] text-[#2fa36b] border-[#caecd8] shadow-sm"
                hasRightHandle={true}
                rightHandleColor="bg-[#2fa36b]"
                success={true}
              />
            </div>

            {/* Node 2: Normalize Payload (Core Step) */}
            <div 
              className="absolute -translate-x-1/2 -translate-y-1/2" 
              style={{ left: "32%", top: "50%" }}
            >
              <LandingCanvasNode 
                innerRef={setNodeRef("normalize")}
                title="Normalize" 
                subtitle="http_request"
                icon={<Box size={18} strokeWidth={1.8} />}
                familyClass="bg-gradient-to-br from-[#f5f6f8] to-[#eaecf0] text-[#5c6470] border-[#e1e4e8] shadow-sm"
                hasLeftHandle={true}
                hasRightHandle={true}
                success={true}
              />
            </div>

            {/* Node 3: Ask AI (AI Step) */}
            <div 
              className="absolute -translate-x-1/2 -translate-y-1/2" 
              style={{ left: "54%", top: "50%" }}
            >
              <LandingCanvasNode 
                innerRef={setNodeRef("askai")}
                title="Ask AI" 
                subtitle="llm_completion"
                icon={<Sparkles size={18} strokeWidth={1.8} />}
                familyClass="bg-gradient-to-br from-[#f3f0ff] to-[#e7e1ff] text-[#6f63ff] border-[#ddd4ff] shadow-sm"
                hasLeftHandle={true}
                hasRightHandle={true}
                success={true}
              />
            </div>

            {/* Node 4: Slack Alert (App Step - Top Branch) */}
            <div 
              className="absolute -translate-x-1/2 -translate-y-1/2" 
              style={{ left: "80%", top: "25%" }}
            >
              <LandingCanvasNode 
                innerRef={setNodeRef("slack")}
                title="Slack Alert" 
                subtitle="slack_alert"
                icon={<Blocks size={18} strokeWidth={1.8} />}
                familyClass="bg-gradient-to-br from-[#eef9f7] to-[#d8f3ec] text-[#2f8f7b] border-[#cfe9e2] shadow-sm"
                hasLeftHandle={true}
                success={true}
              />
            </div>

            {/* Node 5: Manager Approval (Human Step - Bottom Branch) */}
            <div 
              className="absolute -translate-x-1/2 -translate-y-1/2" 
              style={{ left: "80%", top: "75%" }}
            >
              <LandingCanvasNode 
                innerRef={setNodeRef("approval")}
                title="Approval" 
                subtitle="human_approval"
                icon={<User size={18} strokeWidth={1.8} />}
                familyClass="bg-gradient-to-br from-[#fff3e7] to-[#ffe5cc] text-[#c98632] border-[#f3d9b5] shadow-sm"
                hasLeftHandle={true}
                pending={true}
                active={true}
              />
            </div>

          </div>
        </div>
      </main>

      {/* Dynamic Integrations Section */}
      <section className="py-24 border-t border-black/5 bg-white/40 relative z-10">
        <div className="mx-auto max-w-[1100px] px-6 relative">
          
          <div className="text-center max-w-[600px] mx-auto mb-16">
            <h2 className="ui-badge text-[10px] tracking-[0.2em] font-semibold text-[#6f63ff]/90 border-[#6f63ff]/15 bg-[#f6f4ff]/50 w-fit mx-auto px-3 py-1">
              Modular Connectors
            </h2>
            <h3 className="mt-4 text-3xl font-bold tracking-tight text-ink">
              Shipped natively in the box.
            </h3>
            <p className="mt-3 text-[#757d88] text-[13px] leading-relaxed max-w-[460px] mx-auto">
              Connect external data, query AI engines, and pipe outputs with simple, lightweight packages.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CONNECTORS.map((c, idx) => (
              <div 
                className="group rounded-[12px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(16,20,20,0.02)] hover:shadow-md hover:border-[#6f63ff]/35 transition-all duration-200 flex flex-col justify-between"
                key={idx}
              >
                <div>
                  <div className="flex items-center justify-between gap-3 border-b border-black/5 pb-3 mb-3.5">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-[9px] border text-[18px] shadow-sm ${c.color}`}>
                      {c.icon}
                    </div>
                    <span className={`ui-badge text-[9px] ${c.tagColor}`}>
                      {c.tag}
                    </span>
                  </div>
                  <h4 className="text-[13px] font-bold text-ink tracking-tight">{c.name}</h4>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[#757d88] font-medium">{c.desc}</p>
                </div>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* Stellar Premium Dark Call to Action Section */}
      <section className="py-24 bg-[#171b20] text-white relative overflow-hidden border-t border-black/10 z-10">
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-15 pointer-events-none" style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255, 255, 255, 0.1) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '24px 24px'
        }} />
        {/* Subtle radial glow of ACSA Indigo */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(111,99,255,0.14)_0%,transparent_70%)] pointer-events-none" />
        
        <div className="mx-auto max-w-[800px] px-6 text-center relative z-10">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight">
            Take control of your workflows.
          </h2>
          
          <p className="mt-4 text-[#94a3b8] text-[13px] sm:text-[14px] max-w-lg mx-auto leading-relaxed font-medium">
            Build robust pipelines visually, edit configs in declarative YAML, deploy third-party scripts instantly, and version control your flows via standard Git repositories.
          </p>
          
          <div className="mt-9 flex flex-wrap gap-3.5 justify-center">
            <Link 
              className="inline-flex h-11 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#776cff] to-[#5d52d8] text-white font-semibold px-8 text-[13px] uppercase tracking-[0.14em] transition-all duration-200 shadow-[0_2px_4px_rgba(111,99,255,0.2)] hover:shadow-[0_4px_8px_rgba(111,99,255,0.3)] hover:-translate-y-0.5 border border-[#5d52d8]/20" 
              href="/workflows"
            >
              Launch Studio
            </Link>
            
            <a 
              href="https://github.com/adetoye-dev/acsa" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="inline-flex h-11 items-center justify-center rounded-[10px] border border-white/10 hover:border-white/20 hover:bg-white/5 text-white font-semibold px-8 text-[13px] uppercase tracking-[0.14em] transition-all duration-200"
            >
              Star on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Clean Minimalist Footer */}
      <footer className="bg-white border-t border-black/5 py-12 relative z-10">
        <div className="mx-auto max-w-[1100px] px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img alt="Acsa Logo" className="h-7 w-7 animate-none" src="/acsa-mark.svg" />
            <span className="text-[12px] font-bold tracking-tight text-ink">ACSA Systems</span>
          </div>
          
          <div className="flex items-center gap-5 text-[11px] text-[#757d88] font-semibold">
            <a href="https://github.com/adetoye-dev/acsa" target="_blank" rel="noopener noreferrer" className="hover:text-[#6f63ff] transition-colors">GitHub</a>
            <span className="text-black/10">|</span>
            <span>Apache 2.0 Open Source</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LandingCanvasNode({
  title,
  subtitle,
  icon,
  familyClass,
  hasLeftHandle = false,
  hasRightHandle = false,
  rightHandleColor = null,
  success = false,
  pending = false,
  active = false,
  innerRef = null
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  familyClass: string;
  hasLeftHandle?: boolean;
  hasRightHandle?: boolean;
  rightHandleColor?: string | null;
  success?: boolean;
  pending?: boolean;
  active?: boolean;
  innerRef?: React.Ref<HTMLDivElement> | null;
}) {
  return (
    <div className="flex flex-col items-center select-none group">
      <div 
        ref={innerRef ?? undefined}
        className={`relative h-[56px] w-[56px] rounded-[16px] border bg-white shadow-[0_3px_8px_rgba(16,20,20,0.02)] hover:shadow-[0_8px_20px_rgba(16,20,20,0.05)] hover:border-[#6f63ff]/30 transition-all duration-300 flex items-center justify-center ${active ? 'border-[#6f63ff] ring-2 ring-[#6f63ff]/10 shadow-md bg-white' : 'border-black/10'}`}
      >
        
        {/* Handles */}
        {hasLeftHandle && (
          <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-white bg-[#96a0ab] z-10" />
        )}
        {hasRightHandle && (
          <div className={`absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-white ${rightHandleColor ?? 'bg-[#6f63ff]'} z-10`} />
        )}

        {/* Success badge */}
        {success && (
          <div className="absolute -bottom-1 -right-1 h-4.5 w-4.5 rounded-full border border-white bg-emerald-500 flex items-center justify-center text-white text-[9px] font-bold shadow-sm z-10">
            ✓
          </div>
        )}

        {/* Pending badge */}
        {pending && (
          <div className="absolute -bottom-1 -right-1 h-4.5 w-4.5 rounded-full border border-white bg-amber-500 flex items-center justify-center text-white text-[9px] font-bold shadow-sm z-10">
            ●
          </div>
        )}

        <span className={`inline-flex items-center justify-center border h-8.5 w-8.5 rounded-[10px] shadow-sm ${familyClass}`}>
          {icon}
        </span>
      </div>
      
      <div className="mt-2 text-center">
        <div className="text-[11.5px] font-bold text-ink leading-tight">{title}</div>
        <div className="text-[8.5px] text-[#757d88] leading-none mt-0.5">{subtitle}</div>
      </div>
    </div>
  );
}
