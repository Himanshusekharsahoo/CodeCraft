"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthProvider";
import { Button } from "@/components/ui/button";
import {
  Code2,
  Sparkles,
  Users,
  Bot,
  FolderGit2,
  GitBranch,
  GitCommit,
  Shield,
  ShieldCheck,
  Terminal,
  ArrowRight,
  Play,
  Check,
  CheckCircle2,
  Lock,
  Globe,
  Layers,
  Cpu,
  Menu,
  X,
  FileCode,
  Activity,
  Boxes,
  Radio,
  Clock,
  ExternalLink,
  ChevronRight,
  AlertCircle,
  FileText,
  UserCheck,
} from "lucide-react";

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const ctaLink = user ? "/dashboard" : "/signup";
  const ctaText = user ? "Open Dashboard" : "Start Coding — It's Free";

  return (
    <div className="min-h-screen bg-[#070B14] text-gray-100 font-sans selection:bg-blue-600/30 selection:text-white relative overflow-x-hidden">
      {/* Subtle technical background grid */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03] z-0"
        style={{
          backgroundImage: `radial-gradient(rgba(255, 255, 255, 0.8) 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
        }}
        aria-hidden="true"
      />

      {/* Atmospheric radial ambient light */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[450px] bg-gradient-to-b from-blue-600/10 via-indigo-600/5 to-transparent blur-[140px] pointer-events-none z-0" aria-hidden="true" />
      <div className="fixed top-[1200px] left-1/4 w-[600px] h-[400px] bg-purple-600/5 blur-[160px] pointer-events-none z-0" aria-hidden="true" />

      {/* ========================================================================= */}
      {/* 1. NAVBAR                                                                 */}
      {/* ========================================================================= */}
      <header className="sticky top-0 z-50 w-full border-b border-white/[0.08] bg-[#070B14]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand Logo */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 border border-blue-400/30 group-hover:scale-105 transition-transform">
              <Code2 className="w-4 h-4 text-white" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-white group-hover:text-blue-200 transition-colors">
                CodeCraft
              </span>
              <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/30 tracking-wider">
                IDE
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-gray-400">
            <a href="#features" className="hover:text-gray-200 transition-colors">Features</a>
            <a href="#ai-agent" className="hover:text-gray-200 transition-colors">AI</a>
            <a href="#collaboration" className="hover:text-gray-200 transition-colors">Collaboration</a>
            <a href="#git" className="hover:text-gray-200 transition-colors">Git</a>
            <a href="#security" className="hover:text-gray-200 transition-colors">Security</a>
            {user && (
              <Link href="/dashboard" className="hover:text-gray-200 transition-colors">
                Dashboard
              </Link>
            )}
          </nav>

          {/* Right Action Buttons */}
          <div className="hidden sm:flex items-center gap-3">
            {authLoading ? (
              <div className="w-24 h-8 bg-slate-800/60 rounded-md animate-pulse" />
            ) : user ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push("/dashboard")}
                  className="text-xs text-gray-300 hover:text-white hover:bg-slate-800/60"
                >
                  Dashboard
                </Button>
                <Button
                  size="sm"
                  onClick={() => router.push("/dashboard")}
                  className="text-xs bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-medium shadow-md shadow-blue-500/20 border border-blue-400/20"
                >
                  <span>Open CodeCraft</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push("/login")}
                  className="text-xs text-gray-300 hover:text-white hover:bg-slate-800/60"
                >
                  Sign In
                </Button>
                <Button
                  size="sm"
                  onClick={() => router.push("/signup")}
                  className="text-xs bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-medium shadow-md shadow-blue-500/20 border border-blue-400/20"
                >
                  <span>Get Started</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="sm:hidden p-2 text-gray-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Menu Dropdown */}
        {mobileMenuOpen && (
          <div className="sm:hidden border-b border-white/[0.08] bg-[#070B14]/95 px-5 py-4 space-y-3">
            <nav className="flex flex-col gap-2.5 text-sm text-gray-300 font-medium">
              <a
                href="#features"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1 hover:text-white"
              >
                Features
              </a>
              <a
                href="#ai-agent"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1 hover:text-white"
              >
                AI Agent
              </a>
              <a
                href="#collaboration"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1 hover:text-white"
              >
                Collaboration
              </a>
              <a
                href="#git"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1 hover:text-white"
              >
                Git Version Control
              </a>
              <a
                href="#security"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1 hover:text-white"
              >
                Secure Execution
              </a>
              <a
                href="#workspaces"
                onClick={() => setMobileMenuOpen(false)}
                className="py-1 hover:text-white"
              >
                Workspaces
              </a>
              {user && (
                <Link
                  href="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className="py-1 hover:text-white"
                >
                  Dashboard
                </Link>
              )}
            </nav>
            <div className="pt-3 border-t border-gray-800 flex flex-col gap-2">
              {user ? (
                <Button
                  onClick={() => router.push("/dashboard")}
                  className="w-full bg-blue-600 text-white text-xs py-2"
                >
                  Open Dashboard
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => router.push("/login")}
                    className="w-full border-gray-700 text-gray-200 text-xs py-2"
                  >
                    Sign In
                  </Button>
                  <Button
                    onClick={() => router.push("/signup")}
                    className="w-full bg-blue-600 text-white text-xs py-2"
                  >
                    Get Started — Free
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="relative z-10">
        {/* ========================================================================= */}
        {/* 2. HERO SECTION                                                           */}
        {/* ========================================================================= */}
        <section className="pt-16 pb-12 sm:pt-24 sm:pb-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-[11px] font-mono text-blue-400 mb-6 shadow-sm">
            <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
            <span className="tracking-wide">AI-POWERED COLLABORATIVE IDE</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.1] max-w-4xl mx-auto">
            Code Together. <br />
            Build{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
              Faster.
            </span>
          </h1>

          {/* Supporting Text */}
          <p className="mt-6 text-base sm:text-lg text-gray-400 max-w-2xl mx-auto font-normal leading-relaxed">
            An AI-powered collaborative browser IDE for writing, reviewing, executing, and improving code together in real time.
          </p>

          {/* Action CTAs */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3.5">
            <Button
              onClick={() => router.push(ctaLink)}
              className="w-full sm:w-auto px-7 py-3 text-sm font-semibold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg shadow-xl shadow-blue-600/25 border border-blue-400/20 transition-all transform hover:-translate-y-0.5 flex items-center justify-center gap-2 group"
            >
              <span>{ctaText}</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Button>
            <a
              href="#overview"
              className="w-full sm:w-auto px-6 py-2.5 text-sm font-medium text-gray-300 hover:text-white bg-slate-900/80 hover:bg-slate-800/80 border border-white/[0.08] rounded-lg transition-all text-center flex items-center justify-center gap-2"
            >
              <span>Explore CodeCraft</span>
              <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
            </a>
          </div>

          {/* ======================================================================= */}
          {/* 3. HERO PRODUCT PREVIEW (MINIATURE REALISTIC IDE)                       */}
          {/* ======================================================================= */}
          <div id="overview" className="mt-14 relative max-w-5xl mx-auto">
            {/* Ambient backlight glow */}
            <div className="absolute -inset-1.5 bg-gradient-to-r from-blue-600/20 via-indigo-600/20 to-purple-600/20 rounded-2xl blur-xl opacity-70 pointer-events-none" aria-hidden="true" />

            {/* IDE Window Frame */}
            <div className="relative rounded-xl border border-white/[0.12] bg-[#0A0F1D] shadow-2xl shadow-black/80 overflow-hidden text-left flex flex-col">
              {/* Window Titlebar */}
              <div className="h-10 bg-[#0D1424] border-b border-white/[0.08] px-4 flex items-center justify-between select-none">
                {/* Traffic lights & Workspace name */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80 inline-block" />
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500/80 inline-block" />
                  </div>
                  <div className="hidden sm:flex items-center gap-2 text-xs font-mono text-gray-300">
                    <span className="font-semibold text-white">CodeCraft</span>
                    <span className="text-gray-600">/</span>
                    <span className="text-gray-400">cloud-payment-service</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-gray-400 border border-gray-700 flex items-center gap-1">
                      <GitBranch className="w-2.5 h-2.5 text-blue-400" />
                      <span>main</span>
                    </span>
                  </div>
                </div>

                {/* Status indicator & Active Collaborators */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>3 Online</span>
                  </div>
                  <div className="hidden md:flex -space-x-1.5">
                    <div className="w-5 h-5 rounded-full bg-blue-600 border border-slate-900 text-[9px] font-bold flex items-center justify-center text-white" title="You">
                      U
                    </div>
                    <div className="w-5 h-5 rounded-full bg-amber-600 border border-slate-900 text-[9px] font-bold flex items-center justify-center text-white" title="Alex">
                      A
                    </div>
                    <div className="w-5 h-5 rounded-full bg-emerald-600 border border-slate-900 text-[9px] font-bold flex items-center justify-center text-white" title="Sarah">
                      S
                    </div>
                  </div>
                </div>
              </div>

              {/* Window Body (3 columns on desktop) */}
              <div className="grid grid-cols-12 min-h-[380px] bg-[#070B14]">
                {/* Column 1: File Explorer (hidden on mobile) */}
                <div className="hidden sm:block sm:col-span-3 lg:col-span-2 border-r border-white/[0.08] bg-[#090E1B] p-3 text-xs font-mono">
                  <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2.5 flex items-center justify-between">
                    <span>Explorer</span>
                    <span className="text-gray-600">src</span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-gray-400 flex items-center gap-1.5 py-0.5">
                      <span className="text-gray-600">▾</span>
                      <span className="text-gray-300">src</span>
                    </div>
                    <div className="pl-4 space-y-1">
                      <div className="bg-blue-600/15 text-blue-300 border-l-2 border-blue-500 pl-2 py-1 flex items-center gap-1.5 rounded-r">
                        <FileCode className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                        <span className="truncate">auth.js</span>
                      </div>
                      <div className="text-gray-400 hover:text-gray-200 pl-2 py-0.5 flex items-center gap-1.5">
                        <FileCode className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                        <span className="truncate">server.js</span>
                      </div>
                      <div className="text-gray-400 hover:text-gray-200 pl-2 py-0.5 flex items-center gap-1.5">
                        <FileCode className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                        <span className="truncate">payment.js</span>
                      </div>
                    </div>

                    <div className="text-gray-400 flex items-center gap-1.5 pt-2">
                      <span className="text-gray-600">▾</span>
                      <span className="text-gray-300">tests</span>
                    </div>
                    <div className="pl-4 space-y-1">
                      <div className="text-gray-400 hover:text-gray-200 pl-2 py-0.5 flex items-center gap-1.5">
                        <FileCode className="w-3.5 h-3.5 text-emerald-500/70 flex-shrink-0" />
                        <span className="truncate">auth.test.js</span>
                      </div>
                    </div>
                    <div className="text-gray-500 pt-2 pl-2 text-[11px] flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-gray-600" />
                      <span>package.json</span>
                    </div>
                  </div>
                </div>

                {/* Column 2: Editor (Center Canvas) */}
                <div className="col-span-12 sm:col-span-9 lg:col-span-6 flex flex-col border-r border-white/[0.08] bg-[#070B14]">
                  {/* Editor Tab bar */}
                  <div className="h-8 bg-[#090E1B] border-b border-white/[0.08] flex items-center px-2 gap-1 text-xs font-mono">
                    <div className="bg-[#070B14] text-white px-3 py-1.5 border-t-2 border-blue-500 flex items-center gap-2 rounded-t text-[11px]">
                      <FileCode className="w-3 h-3 text-blue-400" />
                      <span>auth.js</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Modified" />
                    </div>
                    <div className="text-gray-500 hover:text-gray-300 px-3 py-1.5 flex items-center gap-2 text-[11px]">
                      <span>server.js</span>
                    </div>
                  </div>

                  {/* Code Editor Body */}
                  <div className="p-3 sm:p-4 font-mono text-xs leading-relaxed overflow-x-auto flex-1">
                    <div className="table w-full">
                      {/* Line 1 */}
                      <div className="table-row">
                        <span className="table-cell pr-3 text-right text-gray-600 select-none text-[11px]">1</span>
                        <span className="table-cell text-purple-400">import <span className="text-gray-200">&#123; verifyToken &#125;</span> from <span className="text-emerald-300">&quot;@/lib/auth&quot;</span>;</span>
                      </div>
                      {/* Line 2 */}
                      <div className="table-row">
                        <span className="table-cell pr-3 text-right text-gray-600 select-none text-[11px]">2</span>
                        <span className="table-cell text-gray-500">{"// Real-time collaborative session validator"}</span>
                      </div>
                      {/* Line 3 */}
                      <div className="table-row">
                        <span className="table-cell pr-3 text-right text-gray-600 select-none text-[11px]">3</span>
                        <span className="table-cell text-purple-400">export async function <span className="text-blue-400">authorizeSession</span><span className="text-gray-300">(req, res) &#123;</span></span>
                      </div>
                      {/* Line 4 */}
                      <div className="table-row">
                        <span className="table-cell pr-3 text-right text-gray-600 select-none text-[11px]">4</span>
                        <span className="table-cell pl-4 text-gray-300">const authHeader = req.headers.authorization;</span>
                      </div>
                      {/* Line 5 */}
                      <div className="table-row">
                        <span className="table-cell pr-3 text-right text-gray-600 select-none text-[11px]">5</span>
                        <span className="table-cell pl-4 text-purple-400">if <span className="text-gray-300">(!authHeader?.startsWith(&quot;Bearer &quot;)) &#123;</span></span>
                      </div>
                      {/* Line 6 */}
                      <div className="table-row">
                        <span className="table-cell pr-3 text-right text-gray-600 select-none text-[11px]">6</span>
                        <span className="table-cell pl-8 text-purple-400">return <span className="text-gray-300">res.status(401).json(&#123; error: &quot;Unauthorized&quot; &#125;);</span></span>
                      </div>
                      {/* Line 7 */}
                      <div className="table-row">
                        <span className="table-cell pr-3 text-right text-gray-600 select-none text-[11px]">7</span>
                        <span className="table-cell pl-4 text-gray-300">&#125;</span>
                      </div>
                      {/* Line 8 - Collaborator Alex Cursor */}
                      <div className="table-row bg-amber-500/10">
                        <span className="table-cell pr-3 text-right text-amber-500 select-none text-[11px]">8</span>
                        <span className="table-cell pl-4 text-gray-300 relative">
                          <span className="text-purple-400">const</span> token = authHeader.split(&quot; &quot;)[1];
                          <span className="inline-block w-0.5 h-4 bg-amber-400 align-middle ml-0.5 animate-pulse" />
                          <span className="ml-1 text-[9px] font-mono bg-amber-500 text-black px-1.5 py-0.2 rounded font-bold">Alex</span>
                        </span>
                      </div>
                      {/* Line 9 */}
                      <div className="table-row">
                        <span className="table-cell pr-3 text-right text-gray-600 select-none text-[11px]">9</span>
                        <span className="table-cell pl-4 text-purple-400">const</span> <span className="text-gray-300">payload = await verifyToken(token);</span>
                      </div>
                      {/* Line 10 */}
                      <div className="table-row">
                        <span className="table-cell pr-3 text-right text-gray-600 select-none text-[11px]">10</span>
                        <span className="table-cell pl-4 text-purple-400">return <span className="text-gray-300">&#123; valid: true, userId: payload.sub &#125;;</span></span>
                      </div>
                      {/* Line 11 */}
                      <div className="table-row">
                        <span className="table-cell pr-3 text-right text-gray-600 select-none text-[11px]">11</span>
                        <span className="table-cell text-gray-300">&#125;</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Column 3: AI Agent Panel */}
                <div className="hidden lg:flex lg:col-span-4 flex-col bg-[#090E1B] p-3 text-xs font-sans justify-between">
                  <div>
                    {/* Header */}
                    <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-white/[0.08]">
                      <div className="flex items-center gap-1.5 font-bold text-white text-xs">
                        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                        <span>AI Agent</span>
                      </div>
                      <span className="text-[10px] font-mono bg-blue-500/10 text-blue-300 px-1.5 py-0.5 rounded border border-blue-500/30">
                        Autonomous
                      </span>
                    </div>

                    {/* Task Request Card */}
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-gray-800 mb-3">
                      <div className="text-[10px] uppercase font-mono text-gray-500 mb-1">Current Goal</div>
                      <p className="text-xs text-gray-200 font-medium leading-relaxed">
                        &quot;Fix the authentication error in this project.&quot;
                      </p>
                    </div>

                    {/* Execution Steps */}
                    <div className="space-y-2 font-mono text-[11px]">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Inspecting files</span>
                      </div>
                      <div className="flex items-center gap-2 text-emerald-400">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Reading auth.js</span>
                      </div>
                      <div className="flex items-center gap-2 text-emerald-400">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Applying changes</span>
                      </div>
                      <div className="flex items-center gap-2 text-blue-400 font-semibold">
                        <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                        <span>Running tests in sandbox...</span>
                      </div>
                    </div>
                  </div>

                  {/* Summary / Result Pill */}
                  <div className="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between text-[11px]">
                    <span className="text-gray-400 font-mono">3 files changed</span>
                    <span className="text-blue-400 hover:text-blue-300 font-medium flex items-center gap-1 cursor-pointer">
                      <span>View Changes</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              </div>

              {/* Window Bottom Status Bar */}
              <div className="h-7 bg-[#090E1B] border-t border-white/[0.08] px-3 flex items-center justify-between text-[11px] font-mono text-gray-500 select-none">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>0 Problems</span>
                  </span>
                  <span className="hidden sm:inline text-gray-400">Output: Ready</span>
                  <span className="hidden md:inline text-gray-500">Docker Sandbox: Active</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-400">UTF-8</span>
                  <span className="text-gray-400">JavaScript</span>
                  <span className="text-blue-400">CRDT Synced</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 4. CAPABILITY STRIP                                                       */}
        {/* ========================================================================= */}
        <section id="features" className="border-y border-white/[0.08] bg-[#0A0F1F]/60 backdrop-blur-sm py-10 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Capability 1 */}
            <div className="flex items-start gap-3.5 p-3 rounded-lg hover:bg-slate-900/50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">AI Assistance</h2>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  Autonomous workspace-aware agent that inspects, edits, runs tests, and repairs code.
                </p>
              </div>
            </div>

            {/* Capability 2 */}
            <div className="flex items-start gap-3.5 p-3 rounded-lg hover:bg-slate-900/50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                <Users className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Real-time Collaboration</h2>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  Multi-user synchronized editing with Yjs CRDT, live cursors, and presence awareness.
                </p>
              </div>
            </div>

            {/* Capability 3 */}
            <div className="flex items-start gap-3.5 p-3 rounded-lg hover:bg-slate-900/50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center flex-shrink-0">
                <FolderGit2 className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Git Version Control</h2>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  First-class visual source control with staging, branching, diffs, and atomic commits.
                </p>
              </div>
            </div>

            {/* Capability 4 */}
            <div className="flex items-start gap-3.5 p-3 rounded-lg hover:bg-slate-900/50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Secure Code Execution</h2>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  Isolated, resource-limited Docker sandbox with strict non-root execution boundaries.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 5. SECTION 01 / AI DEVELOPMENT                                            */}
        {/* ========================================================================= */}
        <section id="ai-agent" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left: Realistic AI Agent UI Panel */}
            <div className="lg:col-span-6 order-2 lg:order-1">
              <div className="rounded-xl border border-white/[0.1] bg-[#0A0F1E] shadow-2xl p-6 relative overflow-hidden">
                {/* Subtle top gradient strip */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />

                {/* Panel Header */}
                <div className="flex items-center justify-between pb-4 border-b border-gray-800">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-bold text-white">✦ AI Agent</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    Bounded Repair Loop
                  </span>
                </div>

                {/* Prompt Box */}
                <div className="mt-4 p-3.5 rounded-lg bg-slate-900/90 border border-gray-800">
                  <div className="text-[10px] font-mono uppercase text-gray-500 mb-1">User Instruction</div>
                  <div className="text-xs text-gray-200 font-medium">
                    Fix the authentication error in this project.
                  </div>
                </div>

                {/* Status Activity Feed */}
                <div className="mt-5 space-y-3 font-mono text-xs">
                  <div className="flex items-center gap-2.5 text-emerald-400">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>✓ Inspecting files</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-emerald-400">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>✓ Reading auth.js</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-emerald-400">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <span>✓ Applying changes</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-blue-400 font-semibold">
                    <div className="w-4 h-4 flex items-center justify-center">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping" />
                    </div>
                    <span>◉ Running tests</span>
                  </div>
                </div>

                {/* Result Card */}
                <div className="mt-6 pt-4 border-t border-gray-800 flex items-center justify-between">
                  <div className="text-xs font-mono text-gray-400">
                    <span className="text-white font-bold">3 files</span> changed
                  </div>
                  <button
                    type="button"
                    className="text-xs font-medium text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                  >
                    <span>View Changes</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Copy & Workflow */}
            <div className="lg:col-span-6 order-1 lg:order-2">
              <div className="text-xs font-mono text-blue-400 font-semibold tracking-wider mb-2">
                01 / AI DEVELOPMENT
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                Your AI pair programmer, <br />
                inside the IDE.
              </h2>
              <p className="mt-4 text-sm sm:text-base text-gray-400 leading-relaxed">
                CodeCraft&apos;s AI Agent can understand your workspace, inspect files, make controlled changes, run code, execute tests, analyze failures, and help fix issues.
              </p>

              {/* Horizontal / Step Workflow */}
              <div className="mt-8 pt-6 border-t border-gray-800/80">
                <div className="text-xs font-mono uppercase text-gray-500 tracking-wider mb-3">
                  Autonomous Workflow Cycle
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  {["Request", "Understand", "Inspect", "Edit", "Execute", "Test", "Review"].map((step, idx, arr) => (
                    <React.Fragment key={step}>
                      <span className="px-2.5 py-1 rounded bg-slate-900 border border-gray-800 text-gray-300 font-medium">
                        {step}
                      </span>
                      {idx < arr.length - 1 && (
                        <span className="text-gray-600 font-bold">→</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 6. SECTION 02 / COLLABORATION                                             */}
        {/* ========================================================================= */}
        <section id="collaboration" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/[0.08]">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left: Copy */}
            <div className="lg:col-span-6">
              <div className="text-xs font-mono text-indigo-400 font-semibold tracking-wider mb-2">
                02 / COLLABORATION
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                Code together, <br />
                in real time.
              </h2>
              <p className="mt-4 text-sm sm:text-base text-gray-400 leading-relaxed">
                Work on the same codebase with synchronized editing, live cursors, collaborator presence, and resilient reconnect/offline behavior.
              </p>
              <ul className="mt-6 space-y-2.5 text-xs sm:text-sm text-gray-300">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>Conflict-free replicated data types (Yjs CRDT)</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>Color-coded live user cursors and text selection ranges</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-indigo-400" />
                  <span>Automatic heartbeat re-sync with client-side offline buffer</span>
                </li>
              </ul>
            </div>

            {/* Right: Collaborative Editor Preview */}
            <div className="lg:col-span-6">
              <div className="rounded-xl border border-white/[0.1] bg-[#0A0F1E] shadow-2xl p-5 overflow-hidden">
                {/* Active Presence Bar */}
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-800 text-xs font-mono">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5 text-blue-400">
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                      <span>You</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-amber-400">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span>Alex</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span>Developer 2</span>
                    </span>
                  </div>
                  <span className="text-gray-500 text-[11px]">3 cursors active</span>
                </div>

                {/* Editor Content with Cursors */}
                <div className="p-4 bg-[#070B14] rounded-lg border border-gray-800/80 font-mono text-xs leading-relaxed">
                  <div className="text-purple-400">function <span className="text-blue-400">buildProject</span>() &#123;</div>
                  <div className="pl-4 text-gray-300 relative my-1">
                    const result = compile();
                    {/* Alex Cursor */}
                    <div className="inline-block relative ml-2">
                      <span className="w-0.5 h-4 bg-amber-400 inline-block align-middle animate-pulse" />
                      <div className="absolute -top-5 left-0 px-1 py-0.2 bg-amber-500 text-black text-[9px] font-bold rounded">
                        Alex
                      </div>
                    </div>
                  </div>
                  <div className="pl-4 text-gray-300 relative my-1">
                    return result;
                    {/* You Cursor */}
                    <div className="inline-block relative ml-1">
                      <span className="w-0.5 h-4 bg-blue-400 inline-block align-middle animate-pulse" />
                      <div className="absolute -top-5 left-0 px-1 py-0.2 bg-blue-500 text-white text-[9px] font-bold rounded">
                        You
                      </div>
                    </div>
                  </div>
                  <div className="text-purple-400">&#125;</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 7. SECTION 03 / VERSION CONTROL                                           */}
        {/* ========================================================================= */}
        <section id="git" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/[0.08]">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left: Realistic Source Control UI */}
            <div className="lg:col-span-6 order-2 lg:order-1">
              <div className="rounded-xl border border-white/[0.1] bg-[#0A0F1E] shadow-2xl p-5">
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-gray-800 text-xs font-mono">
                  <div className="flex items-center gap-2 text-white font-bold">
                    <FolderGit2 className="w-4 h-4 text-purple-400" />
                    <span>SOURCE CONTROL</span>
                  </div>
                  <span className="text-gray-400 flex items-center gap-1 text-[11px]">
                    <GitBranch className="w-3 h-3 text-blue-400" />
                    <span>main</span>
                  </span>
                </div>

                {/* Staged Changes */}
                <div className="mt-4">
                  <div className="text-[11px] font-mono text-gray-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                    <span>Staged Changes</span>
                    <span className="px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-400 font-bold text-[10px]">1</span>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-gray-800 font-mono text-xs flex items-center justify-between text-gray-300">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 font-bold">M</span>
                      <span>api.js</span>
                    </div>
                    <span className="text-[10px] text-gray-500">Ready</span>
                  </div>
                </div>

                {/* Working Tree Changes */}
                <div className="mt-4">
                  <div className="text-[11px] font-mono text-gray-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                    <span>Changes</span>
                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-gray-400 font-bold text-[10px]">2</span>
                  </div>
                  <div className="space-y-1.5 font-mono text-xs">
                    <div className="p-2 rounded bg-slate-900 border border-gray-800 flex items-center justify-between text-gray-300">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-400 font-bold">M</span>
                        <span>app.js</span>
                      </div>
                      <span className="text-[10px] text-blue-400 hover:underline cursor-pointer">Stage</span>
                    </div>
                    <div className="p-2 rounded bg-slate-900 border border-gray-800 flex items-center justify-between text-gray-300">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-bold">A</span>
                        <span>utils.js</span>
                      </div>
                      <span className="text-[10px] text-blue-400 hover:underline cursor-pointer">Stage</span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-5 pt-4 border-t border-gray-800 flex items-center gap-2">
                  <Button
                    size="sm"
                    className="flex-1 bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium"
                  >
                    <GitCommit className="w-3.5 h-3.5 mr-1" />
                    <span>Commit Changes</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-gray-700 text-gray-300 hover:text-white text-xs"
                  >
                    View Diff
                  </Button>
                </div>
              </div>
            </div>

            {/* Right: Copy */}
            <div className="lg:col-span-6 order-1 lg:order-2">
              <div className="text-xs font-mono text-purple-400 font-semibold tracking-wider mb-2">
                03 / VERSION CONTROL
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                Your Git workflow, <br />
                inside your workspace.
              </h2>
              <p className="mt-4 text-sm sm:text-base text-gray-400 leading-relaxed">
                Full-featured source control right in the browser. Inspect file diffs, stage modifications, craft commit messages, switch branches, restore versions, and resolve merge conflicts.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3 text-xs font-mono text-gray-300">
                <div className="p-2.5 rounded bg-slate-900 border border-gray-800">
                  <span className="text-purple-400 block font-bold mb-0.5">Unified Diffing</span>
                  Side-by-side Monaco diff inspection
                </div>
                <div className="p-2.5 rounded bg-slate-900 border border-gray-800">
                  <span className="text-purple-400 block font-bold mb-0.5">Branch Manager</span>
                  Checkout, create, and fast-forward
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 8. SECTION 04 / SECURE EXECUTION                                          */}
        {/* ========================================================================= */}
        <section id="security" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/[0.08]">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <div className="text-xs font-mono text-emerald-400 font-semibold tracking-wider mb-2">
              04 / SECURE EXECUTION
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
              Run code without <br />
              trusting the host.
            </h2>
            <p className="mt-4 text-sm sm:text-base text-gray-400 leading-relaxed">
              CodeCraft isolates user code in dedicated ephemeral sandbox containers with strictly enforced limits.
            </p>
          </div>

          {/* Technical Architecture Visual */}
          <div className="rounded-xl border border-white/[0.1] bg-[#0A0F1E] shadow-2xl p-6 sm:p-8 max-w-4xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-center text-center font-mono text-xs">
              <div className="p-3.5 rounded-lg bg-slate-900 border border-gray-800 text-white">
                <Code2 className="w-5 h-5 mx-auto mb-1.5 text-blue-400" />
                <span className="font-bold">CodeCraft</span>
                <span className="block text-[10px] text-gray-500 mt-0.5">Browser IDE</span>
              </div>
              <div className="text-gray-600 font-bold hidden sm:block">→</div>
              <div className="p-3.5 rounded-lg bg-slate-900 border border-gray-800 text-white">
                <Cpu className="w-5 h-5 mx-auto mb-1.5 text-indigo-400" />
                <span className="font-bold">Execution Service</span>
                <span className="block text-[10px] text-gray-500 mt-0.5">Node Gateway</span>
              </div>
              <div className="text-gray-600 font-bold hidden sm:block">→</div>
              <div className="p-3.5 rounded-lg bg-slate-900 border border-emerald-500/30 text-white">
                <ShieldCheck className="w-5 h-5 mx-auto mb-1.5 text-emerald-400" />
                <span className="font-bold">Isolated Sandbox</span>
                <span className="block text-[10px] text-emerald-400 mt-0.5">Docker Container</span>
              </div>
            </div>

            {/* Security Guarantee Indicators */}
            <div className="mt-8 pt-6 border-t border-gray-800 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
              <div className="p-2 rounded bg-slate-900/60 border border-gray-800 text-[11px] font-mono text-gray-300">
                <span className="text-emerald-400 block font-bold">Network Restricted</span>
                No raw egress
              </div>
              <div className="p-2 rounded bg-slate-900/60 border border-gray-800 text-[11px] font-mono text-gray-300">
                <span className="text-emerald-400 block font-bold">Resource Limits</span>
                512MB RAM cap
              </div>
              <div className="p-2 rounded bg-slate-900/60 border border-gray-800 text-[11px] font-mono text-gray-300">
                <span className="text-emerald-400 block font-bold">Timeout Guards</span>
                10s execution bound
              </div>
              <div className="p-2 rounded bg-slate-900/60 border border-gray-800 text-[11px] font-mono text-gray-300">
                <span className="text-emerald-400 block font-bold">Non-root Execution</span>
                UID 1000 sandboxed
              </div>
              <div className="p-2 rounded bg-slate-900/60 border border-gray-800 text-[11px] font-mono text-gray-300 col-span-2 sm:col-span-1">
                <span className="text-emerald-400 block font-bold">Fail-closed</span>
                Zero host fallback
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 9. SECTION 05 / WORKSPACES                                                */}
        {/* ========================================================================= */}
        <section id="workspaces" className="py-20 lg:py-28 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/[0.08]">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left: Copy */}
            <div className="lg:col-span-5">
              <div className="text-xs font-mono text-blue-400 font-semibold tracking-wider mb-2">
                05 / WORKSPACES
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                Your projects. <br />
                One workspace hub.
              </h2>
              <p className="mt-4 text-sm sm:text-base text-gray-400 leading-relaxed">
                Create workspaces. Invite collaborators. Manage member roles. Open projects directly into the IDE without duplication or friction.
              </p>
              <div className="mt-6 space-y-3 text-xs sm:text-sm text-gray-300">
                <div className="flex items-center gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  <span>Role-based permissions (Owner, Contributor, Viewer)</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  <span>Real-time pending invitations and instant membership</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  <span>Direct client-side routing preserving existing project IDs</span>
                </div>
              </div>
            </div>

            {/* Right: Miniature Dashboard Preview */}
            <div className="lg:col-span-7">
              <div className="rounded-xl border border-white/[0.1] bg-[#0A0F1E] shadow-2xl p-5">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-gray-800">
                  <span className="text-xs font-mono font-bold text-gray-400 uppercase tracking-wider">
                    My Workspaces
                  </span>
                  <span className="text-[11px] font-mono text-blue-400">2 Active Projects</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Workspace Card 1 */}
                  <div className="p-4 rounded-lg bg-slate-900/90 border border-gray-800 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-950/60 text-purple-300 border border-purple-700/50">
                          Owner
                        </span>
                        <span className="text-[10px] font-mono text-gray-500">Public</span>
                      </div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                        <Code2 className="w-4 h-4 text-blue-400" />
                        <span>prototype-service</span>
                      </h3>
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                        Real-time collaborative API server and dashboard.
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between text-[11px] text-gray-400 font-mono">
                      <span>3 members</span>
                      <span className="text-blue-400 font-semibold flex items-center gap-1">
                        Open →
                      </span>
                    </div>
                  </div>

                  {/* Workspace Card 2 */}
                  <div className="p-4 rounded-lg bg-slate-900/90 border border-gray-800 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-700/50">
                          Contributor
                        </span>
                        <span className="text-[10px] font-mono text-gray-500">Private</span>
                      </div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                        <Code2 className="w-4 h-4 text-indigo-400" />
                        <span>collaborative-ml</span>
                      </h3>
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                        Shared machine learning inference workspace.
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-gray-800/80 flex items-center justify-between text-[11px] text-gray-400 font-mono">
                      <span>5 members</span>
                      <span className="text-blue-400 font-semibold flex items-center gap-1">
                        Open →
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 10. TECHNOLOGY / TRUST SECTION                                            */}
        {/* ========================================================================= */}
        <section className="py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-white/[0.08] text-center">
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight mb-8">
            Built for modern development.
          </h2>

          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 max-w-4xl mx-auto">
            <div className="px-4 py-2 rounded-lg bg-slate-900/80 border border-white/[0.08] text-xs font-mono text-gray-300 flex items-center gap-2">
              <Code2 className="w-3.5 h-3.5 text-blue-400" />
              <span>Monaco Editor</span>
            </div>
            <div className="px-4 py-2 rounded-lg bg-slate-900/80 border border-white/[0.08] text-xs font-mono text-gray-300 flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-indigo-400" />
              <span>Yjs CRDT</span>
            </div>
            <div className="px-4 py-2 rounded-lg bg-slate-900/80 border border-white/[0.08] text-xs font-mono text-gray-300 flex items-center gap-2">
              <Boxes className="w-3.5 h-3.5 text-purple-400" />
              <span>Firebase Auth & Sync</span>
            </div>
            <div className="px-4 py-2 rounded-lg bg-slate-900/80 border border-white/[0.08] text-xs font-mono text-gray-300 flex items-center gap-2">
              <FolderGit2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Git Engine</span>
            </div>
            <div className="px-4 py-2 rounded-lg bg-slate-900/80 border border-white/[0.08] text-xs font-mono text-gray-300 flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              <span>Docker Sandbox</span>
            </div>
            <div className="px-4 py-2 rounded-lg bg-slate-900/80 border border-white/[0.08] text-xs font-mono text-gray-300 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Gemini AI</span>
            </div>
          </div>
        </section>

        {/* ========================================================================= */}
        {/* 11. FINAL CTA                                                             */}
        {/* ========================================================================= */}
        <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto text-center border-t border-white/[0.08]">
          <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
            Ready to build together?
          </h2>
          <p className="mt-4 text-base text-gray-400 max-w-lg mx-auto">
            Create your first workspace and start coding with AI.
          </p>
          <div className="mt-8 flex justify-center">
            <Button
              size="lg"
              onClick={() => router.push(ctaLink)}
              className="px-8 py-3 text-sm font-semibold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg shadow-xl shadow-blue-600/25 border border-blue-400/20 transition-all transform hover:-translate-y-0.5 flex items-center gap-2 group"
            >
              <span>{ctaText}</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        </section>
      </main>

      {/* ========================================================================= */}
      {/* 12. FOOTER                                                                */}
      {/* ========================================================================= */}
      <footer className="border-t border-white/[0.08] bg-[#050810] py-12 px-4 sm:px-6 lg:px-8 text-xs text-gray-500">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          {/* Brand Info */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center">
                <Code2 className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-bold text-white">CodeCraft</span>
            </div>
            <p className="text-gray-400 leading-relaxed">
              AI-powered collaborative development in your browser.
            </p>
          </div>

          {/* Product */}
          <div>
            <div className="font-semibold text-gray-300 uppercase tracking-wider font-mono text-[11px] mb-3">
              Product
            </div>
            <ul className="space-y-2">
              <li><a href="#features" className="hover:text-gray-300 transition-colors">Features</a></li>
              <li><a href="#workspaces" className="hover:text-gray-300 transition-colors">Workspaces</a></li>
              <li><a href="#ai-agent" className="hover:text-gray-300 transition-colors">AI Agent</a></li>
              <li><a href="#security" className="hover:text-gray-300 transition-colors">Secure Sandbox</a></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <div className="font-semibold text-gray-300 uppercase tracking-wider font-mono text-[11px] mb-3">
              Resources
            </div>
            <ul className="space-y-2">
              <li><a href="#overview" className="hover:text-gray-300 transition-colors">Product Overview</a></li>
              <li><Link href="/dashboard" className="hover:text-gray-300 transition-colors">Workspace Hub</Link></li>
            </ul>
          </div>

          {/* Account */}
          <div>
            <div className="font-semibold text-gray-300 uppercase tracking-wider font-mono text-[11px] mb-3">
              Account
            </div>
            <ul className="space-y-2">
              <li><Link href="/login" className="hover:text-gray-300 transition-colors">Sign In</Link></li>
              <li><Link href="/register" className="hover:text-gray-300 transition-colors">Get Started</Link></li>
              <li><Link href="/dashboard" className="hover:text-gray-300 transition-colors">Dashboard</Link></li>
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto pt-6 border-t border-gray-900 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>&copy; {mounted ? new Date().getFullYear() : 2026} CodeCraft IDE. All rights reserved.</p>
          <p className="font-mono text-[11px] text-gray-600">
            Engineered for high-assurance real-time engineering.
          </p>
        </div>
      </footer>
    </div>
  );
}
