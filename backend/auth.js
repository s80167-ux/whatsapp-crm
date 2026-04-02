const { createClient } = require("@supabase/supabase-js");

const authClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY,
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

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing bearer token." });
  }

  try {
    const {
      data: { user },
      error
    } = await authClient.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired token." });
    }

    req.user = {
      sub: user.id,
      email: user.email
    };
    return next();
  } catch (_error) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

module.exports = {
  registerUser,
  loginUser,
  requireAuth
};
