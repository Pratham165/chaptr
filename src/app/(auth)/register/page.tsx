"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerAction, loginAction } from "../actions";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    const regData = new FormData();
    regData.set("name", name);
    regData.set("email", email);
    regData.set("password", password);
    regData.set("confirmPassword", confirmPassword);

    startTransition(async () => {
      try {
        const regRes = await registerAction(regData);
        if (!regRes.success) {
          setError(regRes.error || "Failed to create account");
          return;
        }

        // Auto sign-in after registration
        const loginData = new FormData();
        loginData.set("email", email);
        loginData.set("password", password);

        await loginAction(loginData);
        router.push("/library");
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) {
          return;
        }
        setError("Account created, but sign-in failed. Please go to the sign-in page.");
      }
    });
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
            Create Your Account
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
              htmlFor="name"
              className="block font-medium text-paper-400 uppercase tracking-wider text-[11px]"
            >
              Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2 bg-ink-950 border border-ink-700 rounded-[4px] text-paper-50 placeholder:text-paper-400/50 text-xs focus:outline-none focus:border-paper-400"
            />
          </div>

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
              placeholder="At least 8 characters"
              className="w-full px-3 py-2 bg-ink-950 border border-ink-700 rounded-[4px] text-paper-50 placeholder:text-paper-400/50 text-xs focus:outline-none focus:border-paper-400"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="confirmPassword"
              className="block font-medium text-paper-400 uppercase tracking-wider text-[11px]"
            >
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              className="w-full px-3 py-2 bg-ink-950 border border-ink-700 rounded-[4px] text-paper-50 placeholder:text-paper-400/50 text-xs focus:outline-none focus:border-paper-400"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full py-2.5 bg-accent-red hover:bg-accent-red-dim disabled:opacity-50 text-paper-50 font-medium rounded-[4px] transition-colors uppercase tracking-wider text-xs"
          >
            {isPending ? "Creating Account..." : "Create Account"}
          </button>
        </form>

        <div className="text-center text-xs text-paper-400 pt-2 border-t border-ink-700/60">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-paper-50 underline hover:text-accent-red decoration-ink-700 underline-offset-2"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
