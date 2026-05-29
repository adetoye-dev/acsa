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

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { fetchEngineJson } from "../lib/engine-client";
import { AuthPage } from "./auth-page";

interface UserProfile {
  id: string;
}

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  logout: () => void;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  const refreshAuth = async () => {
    const token = localStorage.getItem("acsa_session_token");
    
    // If no token exists, we still hit `/api/auth/me` because if `ACSA_DISABLE_AUTH=1` is set,
    // the backend will auto-authorize us as "local" even without a token!
    try {
      const data = await fetchEngineJson<UserProfile>("/api/auth/me");
      if (data && data.id) {
        setUser(data);
      } else {
        setUser(null);
      }
    } catch (err) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAuth();
  }, []);

  const logout = () => {
    localStorage.removeItem("acsa_session_token");
    localStorage.removeItem("acsa_user_email");
    localStorage.removeItem("acsa_user_id");
    setUser(null);
  };

  if (loading) {
    return (
      <div className="auth-loading-screen">
        <style jsx>{`
          .auth-loading-screen {
            position: fixed;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: #0f1319;
            color: #ffffff;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            z-index: 999999;
          }
          
          .auth-pulse-logo {
            width: 48px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, rgba(111, 99, 255, 0.15), rgba(170, 99, 255, 0.15));
            border: 1px solid rgba(111, 99, 255, 0.25);
            border-radius: 14px;
            margin-bottom: 20px;
            animation: pulseAnimation 1.8s infinite ease-in-out;
            box-shadow: 0 0 20px rgba(111, 99, 255, 0.1);
          }

          .auth-pulse-logo svg {
            width: 24px;
            height: 24px;
            fill: none;
            stroke: #9285ff;
            stroke-width: 2;
          }

          .auth-loading-text {
            font-size: 13px;
            font-weight: 500;
            color: rgba(255, 255, 255, 0.45);
            letter-spacing: 0.5px;
          }

          @keyframes pulseAnimation {
            0% {
              transform: scale(0.95);
              box-shadow: 0 0 0 0 rgba(111, 99, 255, 0.3);
            }
            70% {
              transform: scale(1.05);
              box-shadow: 0 0 0 12px rgba(111, 99, 255, 0);
            }
            100% {
              transform: scale(0.95);
              box-shadow: 0 0 0 0 rgba(111, 99, 255, 0);
            }
          }
        `}</style>
        <div className="auth-pulse-logo">
          <svg viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9s2.015-9 4.5-9M3 9h18M3 15h18" />
          </svg>
        </div>
        <div className="auth-loading-text">Loading ACSA Studio...</div>
      </div>
    );
  }

  const isPublicRoute = pathname === "/" || pathname?.startsWith("/design-review");

  if (!user && !isPublicRoute) {
    return <AuthPage onAuthSuccess={refreshAuth} />;
  }

  return (
    <AuthContext.Provider value={{ user, loading, logout, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
