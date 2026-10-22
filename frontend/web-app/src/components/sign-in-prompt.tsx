import Link from "next/link";

/** Shown instead of an error when the API answers 401: the fix is to sign in,
 * not to report a fault (docs/planning/07 §1). */
export function SignInPrompt({ noun = "this page" }: { noun?: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-8 text-center">
      <p className="text-sm text-ink-muted">Sign in to see {noun}.</p>
      <Link
        href="/login"
        className="mt-3 inline-block text-sm font-medium text-primary hover:text-primary-strong"
      >
        Sign in
      </Link>
    </div>
  );
}
