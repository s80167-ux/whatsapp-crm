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

  return (
    <div className="glass-panel w-full max-w-md border border-white/70 bg-white/62 p-8">
      <div className="mb-6">
        <p className="text-sm uppercase tracking-[0.35em] text-emerald-800/70">REZEKI CRM</p>
        <h1 className="mt-3 text-3xl font-semibold text-ink">REZEKI DASHBOARD</h1>
        <p className="mt-2 text-sm text-emerald-950/65">
          Log in to sync conversations, reply from one place, and keep your team focused.
        </p>
      </div>

      <div className="mb-6 flex rounded-2xl bg-emerald-900/6 p-1 shadow-soft ring-1 ring-emerald-900/5">
        <button
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
            mode === "login" ? "bg-white text-emerald-950 shadow-soft" : "text-emerald-900/55"
          }`}
          onClick={() => onModeChange("login")}
          type="button"
        >
          Login
        </button>
        <button
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
            mode === "register" ? "bg-white text-emerald-950 shadow-soft" : "text-emerald-900/55"
          }`}
          onClick={() => onModeChange("register")}
          type="button"
        >
          Register
        </button>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-emerald-950/70">Email</span>
          <input
            className="input-glass"
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="you@company.com"
            type="email"
            value={email}
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-emerald-950/70">Password</span>
          <input
            className="input-glass"
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="Enter your password"
            type="password"
            value={password}
          />
        </label>

        {error ? <p className="text-sm text-rose-500">{error}</p> : null}

        <button className="primary-button w-full" disabled={loading} onClick={onSubmit} type="button">
          {loading || !authReady ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
        </button>

        {mode === "register" ? (
          <p className="text-xs text-emerald-900/45">
            Registration uses Supabase Auth. If email confirmation is enabled in your project, confirm your
            email before signing in.
          </p>
        ) : null}
      </div>
    </div>
  );
}
