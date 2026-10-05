"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const isDev = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_SHOW_DEV_LOGIN === "1";

  async function handleGoogle() {
    setLoading(true);
    await signIn("google", { callbackUrl: "/" });
  }

  async function handleDev(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    const res = await signIn("dev-email", { email, redirect: false });
    if (res?.error) {
      setErr("That email can’t sign in. Use your company address.");
      setLoading(false);
    } else {
      router.push("/");
    }
  }

  return (
    <div className="signin">
      <div className="signin-brand"><BrandMark size={30} /><span>Arena</span></div>
      <h1 className="signin-title">How much you work,<span>and how much your agents do.</span></h1>
      <div className="signin-keys">
        <span><i className="dot dot-human" />Human</span><span><i className="dot dot-agent" />Agents</span><span><i className="dot dot-meeting" />Meetings</span>
      </div>

      <button onClick={handleGoogle} disabled={loading} className="btn" style={{ width: "100%" }}>
        Continue with Google
      </button>
      <p className="help" style={{ marginTop: 12 }}>Use your company Google account.</p>

      {isDev && (
        <form onSubmit={handleDev} className="signin-dev">
          <div className="field">
            <label htmlFor="dev-email">Development login</label>
            <input id="dev-email" className="input" type="email" placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {err ? <p className="notice notice-err" role="alert">{err}</p> : null}
          <button type="submit" disabled={loading} className="btn btn-quiet" style={{ width: "100%" }}>Sign in with email</button>
        </form>
      )}
    </div>
  );
}
