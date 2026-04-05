import { useState } from "react";
import logo from "../../asset/rezeki_dashboard_logo_glass.png";

type LoginFormProps = {
  email: string;
  password: string;
  authReady: boolean;
  mode: "login" | "register";
  loading: boolean;
  error: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onModeChange: (mode: "login" | "register") => void;
  onSubmit: () => void;
};

export function LoginForm(props: LoginFormProps) {
  const {
    email,
    password,
    authReady,
    mode,
    loading,
    error,
    onEmailChange,
    onPasswordChange,
    onModeChange,
    onSubmit
  } = props;

  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="glass-panel w-full max-w-md p-8">
      <div className="mb-6">
        <img
          alt="Rezeki Dashboard logo"
          className="mb-5 h-28 w-auto object-contain"
          src={logo}
        />
        <p className="text-sm text-whatsapp-muted">
          Log in to sync conversations, reply from one place, and keep your team focused.
        </p>
      </div>

      <div className="mb-6 flex rounded-2xl border border-whatsapp-line bg-whatsapp-canvas p-1">
        <button
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
            mode === "login" ? "bg-whatsapp-deep text-white shadow-soft" : "text-whatsapp-muted"
          }`}
          onClick={() => onModeChange("login")}
          type="button"
        >
          Login
        </button>
        <button
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
            mode === "register" ? "bg-whatsapp-deep text-white shadow-soft" : "text-whatsapp-muted"
          }`}
          onClick={() => onModeChange("register")}
          type="button"
        >
          Register
        </button>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-whatsapp-deep">Email</span>
          <input
            className="input-glass"
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="you@company.com"
            type="email"
            value={email}
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-whatsapp-deep">Password</span>
          <div className="relative flex items-center rounded-lg border border-whatsapp-line bg-white transition focus-within:border-whatsapp-dark focus-within:ring-2 focus-within:ring-whatsapp-green/15">
            <input
              className="auth-input-field w-full rounded-lg border-0 bg-transparent px-4 py-2.5 pr-14 text-sm text-ink outline-none placeholder:text-whatsapp-muted"
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="Enter your password"
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              type="button"
              className="icon-hover-trigger absolute inset-y-0 right-4 z-10 my-auto flex h-5 w-5 items-center justify-center text-whatsapp-muted transition-colors hover:text-whatsapp-deep"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
                  <path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
                  <line x1="2" y1="2" x2="22" y2="22"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
              <span className="icon-hover-label">{showPassword ? "Hide password" : "Show password"}</span>
            </button>
          </div>
        </label>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}

        <button className="primary-button w-full" disabled={loading} onClick={onSubmit} type="button">
          {loading || !authReady ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
        </button>

        {mode === "register" ? (
          <p className="text-xs text-whatsapp-muted">
            Registration uses Supabase Auth. If email confirmation is enabled in your project, confirm your
            email before signing in.
          </p>
        ) : null}
      </div>
    </div>
  );
}
