
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const {
  deleteActiveDashboardSession,
  getActiveDashboardSessionId,
  upsertActiveDashboardSession
} = require("./supabase");

const authClient = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function registerUser(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await authClient.auth.signUp({
    email: normalizedEmail,
    password
  });

  if (error) {
    throw error;
  }

  const token = data.session?.access_token || null;

  return {
    user: data.user
      ? {
          id: data.user.id,
          email: data.user.email
        }
      : null,
    token,
    requiresEmailConfirmation: !token
  };
}

async function loginUser(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await authClient.auth.signInWithPassword({
    email: normalizedEmail,
    password
  });

  if (error) {
    throw error;
  }

  if (!data.session || !data.user) {
    const errorWithoutSession = new Error("Authentication succeeded but no session was returned.");
    errorWithoutSession.status = 401;
    throw errorWithoutSession;
  }

  return {
    user: {
      id: data.user.id,
      email: data.user.email
    },
    token: data.session.access_token
  };
}

async function getAuthenticatedUser(token) {
  const {
    data: { user },
    error
  } = await authClient.auth.getUser(token);

  if (error || !user) {
    const authError = new Error("Invalid or expired token.");
    authError.status = 401;
    throw authError;
  }

  return user;
}

async function createDashboardSession(userId, options = {}) {
  const { replaceExisting = false, currentSessionId = null } = options;
  const activeSessionId = await getActiveDashboardSessionId(userId);

  if (activeSessionId) {
    if (currentSessionId && activeSessionId === currentSessionId) {
      return activeSessionId;
    }

    if (!replaceExisting) {
      const conflictError = new Error(
        "This account is already active in another browser or device. End the active session to continue logging in here."
      );
      conflictError.status = 409;
      conflictError.code = "SESSION_ALREADY_ACTIVE";
      throw conflictError;
    }
  }

  const sessionId = crypto.randomUUID();
  await upsertActiveDashboardSession(userId, sessionId);
  return sessionId;
}

async function revokeDashboardSession(userId, sessionId) {
  await deleteActiveDashboardSession(userId, sessionId);
}

async function requireSupabaseAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing bearer token.", code: "AUTH_TOKEN_MISSING" });
  }

  try {
    const user = await getAuthenticatedUser(token);

    req.user = {
      sub: user.id,
      email: user.email
    };
    return next();
  } catch (error) {
    return res.status(error.status || 401).json({
      error: error.message || "Invalid or expired token.",
      code: error.status && error.status !== 401 ? undefined : "AUTH_TOKEN_INVALID"
    });
  }
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const sessionId = String(req.headers["x-session-id"] || "").trim() || null;

  if (!token) {
    return res.status(401).json({ error: "Missing bearer token.", code: "AUTH_TOKEN_MISSING" });
  }

  if (!sessionId) {
    return res.status(401).json({ error: "Missing dashboard session.", code: "SESSION_REQUIRED" });
  }

  try {
    const user = await getAuthenticatedUser(token);
    const activeSessionId = await getActiveDashboardSessionId(user.id);

    if (!activeSessionId || activeSessionId !== sessionId) {
      return res.status(401).json({
        error: "Your account was signed in somewhere else. Please log in again.",
        code: "SESSION_REVOKED"
      });
    }

    req.user = {
      sub: user.id,
      email: user.email
    };
    req.sessionId = sessionId;
    return next();
  } catch (error) {
    return res.status(error.status || 401).json({
      error: error.message || "Invalid or expired token.",
      code: error.status && error.status !== 401 ? undefined : "AUTH_TOKEN_INVALID"
    });
  }
}

module.exports = {
  createDashboardSession,
  registerUser,
  loginUser,
  requireAuth,
  requireSupabaseAuth,
  revokeDashboardSession
};
