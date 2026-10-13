"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { loginAction } from "../actions";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("email", email);
    formData.set("password", password);

    startTransition(async () => {
      try {
        const res = await loginAction(formData);
        if (res && !res.success && res.error) {
          setError(res.error);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) {
          // Normal Next.js redirect in progress
          return;
        }
        setError("Sign in failed. Please check your credentials.");
      }
    });
  };

  const fillDemo = () => {
    setEmail("test-reader@chaptr.app");
    setPassword("password123");
    setError(null);
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-ink-950 text-paper-50 font-sans">
      <div className="w-full max-w-sm space-y-6 rounded-[4px] border border-ink-700 bg-ink-900 p-8 shadow-none">
        <div className="space-y-2 text-center">
          <div className="flex justify-center items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-red" />
            <span className="font-serif text-2xl font-bold tracking-tight text-paper-50">
              CHAPTR
            </span>
          </div>
          <h1 className="text-sm uppercase tracking-widest text-paper-400 font-medium pt-1">
            Sign In to Your Shelf
          </h1>
        </div>

        {error && (
          <div className="p-3 rounded-[4px] bg-accent-red/10 border border-accent-red/30 text-accent-red text-xs space-y-1">
            <p className="font-medium">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label
              htmlFor="email"
              className="block font-medium text-paper-400 uppercase tracking-wider text-[11px]"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="reader@chaptr.app"
              className="w-full px-3 py-2 bg-ink-950 border border-ink-700 rounded-[4px] text-paper-50 placeholder:text-paper-400/50 text-xs focus:outline-none focus:border-paper-400"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="password"
              className="block font-medium text-paper-400 uppercase tracking-wider text-[11px]"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 bg-ink-950 border border-ink-700 rounded-[4px] text-paper-50 placeholder:text-paper-400/50 text-xs focus:outline-none focus:border-paper-400"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full py-2.5 bg-accent-red hover:bg-accent-red-dim disabled:opacity-50 text-paper-50 font-medium rounded-[4px] transition-colors uppercase tracking-wider text-xs"
          >
            {isPending ? "Signing In..." : "Sign In"}
          </button>
        </form>

        <div className="pt-2 border-t border-ink-700/60 space-y-3 text-center text-xs text-paper-400">
          <div className="flex items-center justify-between bg-ink-950 px-3 py-2 rounded-[4px] border border-ink-700/60 text-[11px]">
            <span className="text-paper-400/80">Demo: test-reader@chaptr.app</span>
            <button
              type="button"
              onClick={fillDemo}
              className="text-accent-red hover:underline uppercase font-mono tracking-wider font-semibold text-[10px]"
            >
              Auto-fill
            </button>
          </div>

          <div>
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-medium text-paper-50 underline hover:text-accent-red decoration-ink-700 underline-offset-2"
            >
              Register
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
