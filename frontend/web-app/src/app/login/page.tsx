"use client";

import { DISPLAY_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@ua/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorText, login, register } from "@/lib/api";

type Mode = "signin" | "register";

const MODE_COPY: Record<Mode, { title: string; submit: string; alt: string }> = {
  signin: {
    title: "Sign in",
    submit: "Sign in",
    alt: "New here? Create an account",
  },
  register: {
    title: "Create your account",
    submit: "Create account",
    alt: "Already have an account? Sign in",
  },
};

function modeButtonClasses(active: boolean): string {
  return [
    "rounded-control px-3 py-1.5 text-sm font-medium transition-colors duration-hover ease-standard",
    active ? "bg-surface text-ink shadow-card" : "text-ink-muted hover:text-ink",
  ].join(" ");
}

/**
 * Sign-in and registration (docs/planning/03 §5.1, 07 §3.1).
 *
 * Both live in one form because they are the same three fields and the same
 * response: the API issues the session cookie either way, so there is no token
 * for this page to handle and nothing to store (docs/planning/12 §4).
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = submitting;
  const canSubmit = email.trim() !== "" && password !== "" && !busy;

  function switchMode(next: Mode): void {
    setMode(next);
    setError(null);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    // Checked here rather than left to the API so the message names the rule;
    // the API still enforces it, this only saves a round trip.
    if (mode === "register" && password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (mode === "signin") {
        await login({ email: email.trim(), password });
      } else {
        const name = displayName.trim();
        await register(
          name === ""
            ? { email: email.trim(), password }
            : { email: email.trim(), password, displayName: name },
        );
      }
      router.push("/");
    } catch (cause) {
      setSubmitting(false);
      setError(errorText(cause));
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{MODE_COPY[mode].title}</h1>
        <p className="text-sm text-ink-muted">
          Your agents run on machines you control. Nothing runs until you say so.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="space-y-4 rounded-card border border-line bg-surface p-6 shadow-card"
      >
        <fieldset className="m-0 flex gap-1 rounded-control border-0 bg-canvas p-1">
          <legend className="sr-only">Account</legend>
          <button
            type="button"
            aria-pressed={mode === "signin"}
            onClick={() => switchMode("signin")}
            className={`flex-1 ${modeButtonClasses(mode === "signin")}`}
          >
            Sign in
          </button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            onClick={() => switchMode("register")}
            className={`flex-1 ${modeButtonClasses(mode === "register")}`}
          >
            Create account
          </button>
        </fieldset>

        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-control border border-line bg-canvas px-3 py-2 text-sm focus:bg-surface"
          />
        </div>

        {mode === "register" && (
          <div className="space-y-1">
            <label htmlFor="displayName" className="block text-sm font-medium">
              Name <span className="font-normal text-ink-subtle">(optional)</span>
            </label>
            <input
              id="displayName"
              name="displayName"
              autoComplete="name"
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded-control border border-line bg-canvas px-3 py-2 text-sm focus:bg-surface"
            />
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-control border border-line bg-canvas px-3 py-2 text-sm focus:bg-surface"
          />
          {mode === "register" && (
            <p className="text-xs text-ink-subtle">
              At least {PASSWORD_MIN_LENGTH} characters. Long beats complicated.
            </p>
          )}
        </div>

        {error !== null && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors duration-hover ease-standard hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Working…" : MODE_COPY[mode].submit}
        </button>

        <p className="text-center text-sm">
          <button
            type="button"
            onClick={() => switchMode(mode === "signin" ? "register" : "signin")}
            className="text-primary hover:text-primary-strong"
          >
            {MODE_COPY[mode].alt}
          </button>
        </p>
      </form>

      <p className="text-center text-sm text-ink-subtle">
        <Link href="/" className="hover:text-ink-muted">
          Back to tasks
        </Link>
      </p>
    </div>
  );
}
