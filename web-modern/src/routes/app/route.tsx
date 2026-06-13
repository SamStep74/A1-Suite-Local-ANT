/**
 * App layout — wraps every authenticated route with Topbar + LeftRail + BottomBar
 * + the AppLauncher and AskCommandPalette overlays.
 *
 * Session check: if no Bearer token in sessionStorage, redirect to /login.
 * (The Fastify backend validates the token via `app.auth`; the new app
 * does NOT re-implement auth, just gates UI.)
 */
import { Outlet, createFileRoute, redirect, useRouterState, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Topbar } from "../../components/shell/Topbar";
import { LeftRail } from "../../components/shell/LeftRail";
import { BottomBar } from "../../components/shell/BottomBar";
import { AppLauncher } from "../../components/shell/AppLauncher";
import { AskCommandPalette } from "../../components/command/AskCommandPalette";
import { AskAiPanel } from "../../components/ai/AskAiPanel";
import { postVoid } from "../../lib/api/client";
import { getToken, clearToken } from "../../lib/api/auth-token";
import { APP_IDS, type AppId } from "../../lib/apps";
import { cn } from "../../lib/utils/cn";

export const Route = createFileRoute("/app")({
  // Auth gate is CLIENT-ONLY: `getToken()` reads from `window.sessionStorage`
  // which doesn't exist on the server. The server-side render of /app would
  // always see "no token" and bounce to /login even for a legitimate user
  // reloading the page. The token lives in sessionStorage and persists across
  // client-side navigations; the server doesn't need to know about it.
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    if (!getToken()) {
      throw redirect({ to: "/login" });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();
  const { location } = useRouterState();
  const [appLauncherOpen, setAppLauncherOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Phase 10.5 ask-ai: drawer state. The trigger button lives in
  // the Topbar; the panel mounts at the AppLayout level so its
  // z-index/positioning are independent of any sub-route chrome.
  const [askAiOpen, setAskAiOpen] = useState(false);

  // ⌘K / Ctrl+K toggles the Ask/Command palette globally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Resolve the current app from the URL: /app/finance/invoices → "finance".
  const currentApp = parseAppFromPath(location.pathname);
  const userName = "Owner"; // Phase 1: pull from /api/me

  const onSignOut = useCallback(async () => {
    try {
      await postVoid("/api/logout");
    } catch {
      // ignore — best-effort
    }
    clearToken();
    navigate({ to: "/login" });
  }, [navigate]);

  return (
    <div className="flex h-screen flex-col" data-testid="app-shell">
      <Topbar
        currentApp={currentApp ?? undefined}
        userName={userName}
        onOpenAppLauncher={() => setAppLauncherOpen(true)}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        onOpenNotifications={() => {
          // Phase 1: notifications panel
        }}
        onOpenHelp={() => {
          // Phase 1: AI help panel
        }}
        onOpenAskAi={() => setAskAiOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        <LeftRail onOpenAppLauncher={() => setAppLauncherOpen(true)} />
        <main
          id="main"
          className={cn(
            "flex-1 overflow-y-auto",
            "bg-[var(--color-canvas)]",
          )}
        >
          <Outlet />
        </main>
      </div>

      <BottomBar />

      <AppLauncher open={appLauncherOpen} onClose={() => setAppLauncherOpen(false)} />
      <AskCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onSignOut={onSignOut}
      />
      <AskAiPanel open={askAiOpen} onOpenChange={setAskAiOpen} />
    </div>
  );
}

function parseAppFromPath(pathname: string): AppId | null {
  const m = pathname.match(/^\/app\/([^/?#]+)/);
  if (!m) return null;
  const id = m[1] as AppId;
  return APP_IDS.includes(id) ? id : null;
}
