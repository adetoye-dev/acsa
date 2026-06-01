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
import { useAuth as useClerkAuth, useUser } from "@clerk/nextjs";
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
  const { isLoaded, userId, getToken, signOut } = useClerkAuth();
  const { user: clerkUser } = useUser();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  const refreshAuth = async () => {
    if (!isLoaded) return;
    
    if (userId) {
      try {
        const token = await getToken();
        if (token) {
          localStorage.setItem("acsa_session_token", token);
          if (clerkUser?.primaryEmailAddress?.emailAddress) {
            localStorage.setItem("acsa_user_email", clerkUser.primaryEmailAddress.emailAddress);
          }
          localStorage.setItem("acsa_user_id", userId);
          setUser({ id: userId });
        }
      } catch (err) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    } else {
      // In case auth is completely disabled on the backend (ACSA_DISABLE_AUTH=1)
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
    }
  };

  useEffect(() => {
    if (isLoaded) {
      refreshAuth();
    }
  }, [isLoaded, userId, clerkUser]);

  const logout = () => {
    localStorage.removeItem("acsa_session_token");
    localStorage.removeItem("acsa_user_email");
    localStorage.removeItem("acsa_user_id");
    setUser(null);
    signOut();
  };

  if (loading || !isLoaded) {
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
            background: #0d0f12;
            color: #ffffff;
            font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            z-index: 999999;
            padding: 24px;
          }
          
          .auth-pulse-logo {
            width: 72px;
            height: 72px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, rgba(111, 99, 255, 0.08), rgba(111, 99, 255, 0.15));
            border: 1px solid rgba(111, 99, 255, 0.25);
            border-radius: 20px;
            margin-bottom: 24px;
            animation: pulseAnimation 2s infinite ease-in-out;
            box-shadow: 0 8px 32px rgba(111, 99, 255, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.1);
          }

          .auth-pulse-logo svg {
            width: 44px;
            height: 44px;
          }

          .auth-loading-text {
            font-size: 14px;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.85);
            letter-spacing: 0.5px;
          }

          .auth-sub-loading-text {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.4);
            margin-top: 6px;
            font-weight: 500;
          }

          .auth-troubleshoot-card {
            margin-top: 32px;
            max-width: 400px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 16px;
            padding: 20px;
            text-align: left;
            animation: fadeIn 0.4s ease-out;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3);
          }

          .auth-troubleshoot-header {
            display: flex;
            align-items: center;
            gap: 10px;
            color: #ff9f43;
            font-size: 13.5px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 12px;
          }

          .auth-troubleshoot-body {
            font-size: 12.5px;
            color: rgba(255, 255, 255, 0.7);
            line-height: 1.6;
          }

          .auth-troubleshoot-body p {
            margin: 0 0 10px 0;
          }

          .auth-troubleshoot-body ul {
            margin: 0;
            padding-left: 18px;
          }

          .auth-troubleshoot-body li {
            margin-bottom: 6px;
          }

          @keyframes pulseAnimation {
            0% {
              transform: scale(0.96);
              box-shadow: 0 8px 32px rgba(111, 99, 255, 0.15);
            }
            50% {
              transform: scale(1.04);
              box-shadow: 0 12px 48px rgba(111, 99, 255, 0.25);
            }
            100% {
              transform: scale(0.96);
              box-shadow: 0 8px 32px rgba(111, 99, 255, 0.15);
            }
          }

          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateY(10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
        <div className="auth-pulse-logo">
          {/* Official ACSA Symbol rendered in beautiful purple and white theme */}
          <svg viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: "44px", height: "44px" }}>
            <rect x="96" y="206" width="96" height="96" rx="28" stroke="#a8a2ff" strokeWidth="26"/>
            <rect x="208" y="96" width="96" height="96" rx="28" stroke="#a8a2ff" strokeWidth="26"/>
            <rect x="208" y="320" width="96" height="96" rx="28" stroke="#a8a2ff" strokeWidth="26"/>
            <rect x="320" y="206" width="96" height="96" rx="28" stroke="#a8a2ff" strokeWidth="26"/>
            <path d="M192 254H220" stroke="#a8a2ff" strokeWidth="22" strokeLinecap="round"/>
            <path d="M292 254H320" stroke="#a8a2ff" strokeWidth="22" strokeLinecap="round"/>
            <path d="M256 192V224" stroke="#a8a2ff" strokeWidth="22" strokeLinecap="round"/>
            <path d="M256 288V320" stroke="#a8a2ff" strokeWidth="22" strokeLinecap="round"/>
            <circle cx="256" cy="254" r="18" fill="#FFFFFF" stroke="#a8a2ff" strokeWidth="18"/>
          </svg>
        </div>
        <div className="auth-loading-text">Loading ACSA Studio...</div>
        <div className="auth-sub-loading-text">Connecting to secure session gateway</div>
      </div>
    );
  }

  const isPublicRoute = pathname === "/" || pathname?.startsWith("/design-review");

  if (!user && !isPublicRoute) {
    return <AuthPage />;
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
