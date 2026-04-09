import { useState } from "react";
import logo from "../../asset/rezeki_dashboard_logo_glass.png";

type LoginFormProps = {
  email: string;
  password: string;
  confirmPassword: string;
  authReady: boolean;
  mode: "login" | "register";
  loading: boolean;
  passwordResetRequestLoading: boolean;
  verificationResendLoading: boolean;
  passwordRecoveryActive: boolean;
  replacingActiveSession: boolean;
  error: string;
  notice: string;
  sessionConflictMessage: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onModeChange: (mode: "login" | "register") => void;
  onRequestPasswordReset: () => void;
  onResendVerification: () => void;
  onReplaceActiveSession: () => void;
  onSubmit: () => void;
};

export function LoginForm(props: LoginFormProps) {
  const {
    email,
    password,
    confirmPassword,
    authReady,
    mode,
    loading,
    passwordResetRequestLoading,
    verificationResendLoading,
    passwordRecoveryActive,
    replacingActiveSession,
    error,
    notice,
    sessionConflictMessage,
    onEmailChange,
    onPasswordChange,
    onConfirmPasswordChange,
    onModeChange,
    onRequestPasswordReset,
    onResendVerification,
    onReplaceActiveSession,
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
          {passwordRecoveryActive
            ? "Use the secure recovery session from your email to set a new password before returning to the CRM."
            : "Log in to sync conversations, reply from one place, and keep your team focused."}
        </p>
      </div>

      {!passwordRecoveryActive ? (
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
      ) : null}

      <div className="space-y-4">
        {!passwordRecoveryActive ? (
          <label className="block">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="block text-sm font-medium text-whatsapp-deep">Email</span>
              {mode === "register" ? (
                <button
                  aria-label="Request another verification email"
                  className="icon-hover-trigger flex h-8 w-8 items-center justify-center rounded-full border border-whatsapp-line bg-white text-whatsapp-muted transition hover:border-whatsapp-dark hover:text-whatsapp-deep disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={loading || verificationResendLoading || !authReady}
                  onClick={onResendVerification}
                  type="button"
                >
                  <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
                    <path
                      d="M4 6h16v12H4zM4 7l8 6 8-6M8 11l-2 2m0 0 2 2m-2-2h7"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  <span className="icon-hover-label">
                    {verificationResendLoading ? "Sending verification" : "Resend verification"}
                  </span>
                </button>
              ) : null}
            </div>
            <input
              className="input-glass"
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="you@company.com"
              type="email"
              value={email}
            />
          </label>
        ) : null}

        <label className="block">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="block text-sm font-medium text-whatsapp-deep">
              {passwordRecoveryActive ? "New password" : "Password"}
            </span>
            {mode === "login" && !passwordRecoveryActive ? (
              <button
                aria-label="Request secure password reset"
                className="icon-hover-trigger flex h-8 w-8 items-center justify-center rounded-full border border-whatsapp-line bg-white text-whatsapp-muted transition hover:border-whatsapp-dark hover:text-whatsapp-deep disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading || passwordResetRequestLoading || !authReady}
                onClick={onRequestPasswordReset}
                type="button"
              >
                <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
                  <path
                    d="M12 15v2m-6 2h12a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2Zm1-9V8a5 5 0 1 1 10 0v2"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                <span className="icon-hover-label">
                  {passwordResetRequestLoading ? "Sending reset link" : "Reset password"}
                </span>
              </button>
            ) : null}
          </div>
          <div className="relative flex items-center rounded-lg border border-whatsapp-line bg-white transition focus-within:border-whatsapp-dark focus-within:ring-2 focus-within:ring-whatsapp-green/15">
            <input
              className="auth-input-field w-full rounded-lg border-0 bg-transparent px-4 py-2.5 pr-14 text-sm text-ink outline-none placeholder:text-whatsapp-muted"
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder={passwordRecoveryActive ? "Enter your new password" : "Enter your password"}
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

        {passwordRecoveryActive ? (
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-whatsapp-deep">Confirm password</span>
            <input
              className="input-glass"
              onChange={(event) => onConfirmPasswordChange(event.target.value)}
              placeholder="Repeat your new password"
              type="password"
              value={confirmPassword}
            />
          </label>
        ) : null}

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        {notice ? <p className="text-sm text-whatsapp-dark">{notice}</p> : null}

        {mode === "login" && !passwordRecoveryActive && sessionConflictMessage ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">Active session detected</p>
            <p className="mt-1 text-amber-800">
              This username is already logged in on another browser or device. If that session is no longer in use,
              you can end it and continue logging in here.
            </p>
            <button
              className="mt-3 w-full rounded-xl border border-amber-300 bg-white px-4 py-2 font-medium text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={loading || replacingActiveSession || !authReady}
              onClick={onReplaceActiveSession}
              type="button"
            >
              {replacingActiveSession ? "Ending active session..." : "End active session and continue login"}
            </button>
          </div>
        ) : null}

        <button className="primary-button w-full" disabled={loading} onClick={onSubmit} type="button">
          {loading || !authReady
            ? "Please wait..."
            : passwordRecoveryActive
            ? "Set new password"
            : mode === "login"
            ? "Login"
            : "Create account"}
        </button>

        {mode === "register" && !passwordRecoveryActive ? (
          <p className="text-xs text-whatsapp-muted">
            Registration uses Supabase Auth. If email confirmation is enabled in your project, confirm your
            email before signing in. Use the resend verification button if the email did not arrive or the link expired.
          </p>
        ) : null}
      </div>
    </div>
  );
}
