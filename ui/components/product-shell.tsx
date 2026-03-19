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

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

type ProductShellProps = Readonly<{
  children: ReactNode;
  defaultCollapsed?: boolean;
}>;

const SIDEBAR_COLLAPSED_STORAGE_KEY = "acsa.product-shell.collapsed";

const navItems = [
  {
    href: "/workflows",
    icon: <WorkflowsIcon />,
    label: "Workflows",
    match: (pathname: string) => pathname.startsWith("/workflows")
  },
  {
    href: "/executions",
    icon: <ExecutionsIcon />,
    label: "Executions",
    match: (pathname: string) => pathname.startsWith("/executions")
  },
  {
    href: "/connectors",
    icon: <ConnectorsIcon />,
    label: "Connectors",
    match: (pathname: string) => pathname.startsWith("/connectors")
  }
] as const;

export function ProductShell({
  children,
  defaultCollapsed = false
}: ProductShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(function hydrateSidebarCollapsedPreferenceEffect() {
    const storedValue = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    if (storedValue === "true") {
      setCollapsed(true);
    } else if (storedValue === "false") {
      setCollapsed(false);
    } else {
      setCollapsed(defaultCollapsed);
    }
    setIsHydrated(true);
  }, [defaultCollapsed]);

  useEffect(function persistSidebarCollapsedPreferenceEffect() {
    if (!isHydrated) {
      return;
    }
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? "true" : "false"
    );
  }, [collapsed, isHydrated]);

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-[#f7f7f8]">
      <div
        className={`grid h-full overflow-hidden ${
          collapsed ? "xl:grid-cols-[84px_minmax(0,1fr)]" : "xl:grid-cols-[236px_minmax(0,1fr)]"
        }`}
      >
      <aside
        className="grid min-h-0 grid-rows-[60px_minmax(0,1fr)_auto] border-r border-black/10 bg-[rgba(255,255,255,0.82)]"
      >
        <div className={`flex h-[60px] items-center border-b border-black/10 ${collapsed ? "px-3" : "px-4"}`}>
          <Link
            className={`flex flex-1 items-center ${collapsed ? "justify-center" : "gap-2"}`}
            href="/workflows"
            title="Workflows"
          >
            <img
              alt="Acsa"
              className={`${collapsed ? "h-12 w-12" : "h-11 w-11"} shrink-0`}
              src="/acsa-mark.svg"
            />
            {!collapsed ? (
              <div>
                <div className="text-[13px] font-medium tracking-tight text-ink">ACSA</div>
                <div className="text-[10px] uppercase leading-none tracking-[0.16em] text-slate/55">
                  automation studio
                </div>
              </div>
            ) : null}
          </Link>
        </div>

        <nav className={`sleek-scroll min-h-0 overflow-y-auto ${collapsed ? "px-3 py-4" : "px-3 py-3"}`}>
          <div className="space-y-1.5">
            {navItems.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  className={`rounded-[10px] border text-sm font-medium tracking-tight transition ${
                    active
                      ? "border-black/12 bg-white text-ink"
                      : "border-transparent text-slate hover:border-black/8 hover:bg-white/65 hover:text-ink"
                  } ${collapsed ? "flex justify-center px-0 py-3" : "flex items-center gap-3 px-3 py-2.5"}`}
                  href={item.href}
                  title={item.label}
                >
                  <span className={`${active ? "text-[#6f63ff]" : "text-slate/62"} ${collapsed ? "flex h-5 w-5 items-center justify-center" : ""}`}>
                    {item.icon}
                  </span>
                  {!collapsed ? <span>{item.label}</span> : null}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-black/10" />
      </aside>

      <main className="min-h-0 overflow-hidden">{children}</main>
      </div>

      <button
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={`absolute top-12 z-30 hidden xl:flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-md border border-black/10 bg-white text-slate shadow-[0_1px_2px_rgba(16,20,20,0.06)] transition hover:border-black/15 hover:bg-[#fbfbfc] hover:text-ink ${
          collapsed ? "left-[84px] top-12" : "left-[236px] top-12"
        }`}
        onClick={() => setCollapsed((current) => !current)}
        type="button"
      >
        <CollapseIcon collapsed={collapsed} />
      </button>
    </div>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={
          collapsed
            ? "M5.75 3.25 10.5 8l-4.75 4.75"
            : "M10.25 3.25 5.5 8l4.75 4.75"
        }
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}

function WorkflowsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        height="3.5"
        rx="1.1"
        stroke="currentColor"
        strokeWidth="1.35"
        width="5"
        x="2.25"
        y="2.25"
      />
      <rect
        height="3.5"
        rx="1.1"
        stroke="currentColor"
        strokeWidth="1.35"
        width="5"
        x="8.75"
        y="2.25"
      />
      <rect
        height="3.5"
        rx="1.1"
        stroke="currentColor"
        strokeWidth="1.35"
        width="5"
        x="2.25"
        y="10.25"
      />
      <rect
        height="3.5"
        rx="1.1"
        stroke="currentColor"
        strokeWidth="1.35"
        width="5"
        x="8.75"
        y="10.25"
      />
    </svg>
  );
}

function ExecutionsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 11.75V4.25m5 7.5v-5m5 5V2.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
      <circle cx="3" cy="12" fill="currentColor" r="1.1" />
      <circle cx="8" cy="7" fill="currentColor" r="1.1" />
      <circle cx="13" cy="3" fill="currentColor" r="1.1" />
    </svg>
  );
}

function ConnectorsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.5 4.25H3.75A1.5 1.5 0 0 0 2.25 5.75v.5a1.5 1.5 0 0 0 1.5 1.5H5.5m5 0h1.75a1.5 1.5 0 0 1 1.5 1.5v.5a1.5 1.5 0 0 1-1.5 1.5H10.5M8 2.5v3m0 5v3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <rect
        height="3"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.35"
        width="4.5"
        x="5.75"
        y="6.5"
      />
    </svg>
  );
}
