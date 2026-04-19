const { getProfileByUserId, hydrateProfileAccessFromAuthUser } = require("./supabase");

const VALID_ROLES = new Set(["super_admin", "admin", "user", "agent"]);

function normalizeRole(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return VALID_ROLES.has(normalized) ? normalized : "user";
}

function isSuperAdmin(user) {
  return normalizeRole(user?.role) === "super_admin";
}

async function getRequestUserContext(authUser) {
  const userId = String(authUser?.id || "").trim();

  if (!userId) {
    const error = new Error("Invalid authenticated user.");
    error.status = 401;
    throw error;
  }

  const profile = await hydrateProfileAccessFromAuthUser(authUser) || await getProfileByUserId(userId);
  const role = normalizeRole(profile?.role);
  const organization = profile?.organization || null;
  const organizationId = profile?.organization_id || null;

  if (organization?.status === "suspended" && role !== "super_admin") {
    const error = new Error("Your organization is suspended.");
    error.status = 403;
    error.code = "ORG_SUSPENDED";
    throw error;
  }

  return {
    id: userId,
    sub: userId,
    email: authUser?.email || profile?.email || null,
    role,
    organization_id: organizationId,
    organization,
    profile
  };
}

function requireRole(...roles) {
  const allowedRoles = new Set(roles.map(normalizeRole));

  return (req, res, next) => {
    if (isSuperAdmin(req.user) || allowedRoles.has(normalizeRole(req.user?.role))) {
      return next();
    }

    return res.status(403).json({
      error: "You do not have permission to perform this action.",
      code: "FORBIDDEN"
    });
  };
}

async function canAssignWithinOrg(actor, targetUserId) {
  const normalizedTargetUserId = String(targetUserId || "").trim();

  if (!normalizedTargetUserId) {
    return false;
  }

  if (isSuperAdmin(actor)) {
    return true;
  }

  if (!actor?.organization_id) {
    return normalizedTargetUserId === actor?.id;
  }

  const targetProfile = await getProfileByUserId(normalizedTargetUserId);
  return Boolean(targetProfile?.organization_id && targetProfile.organization_id === actor.organization_id);
}

async function resolveInsertOwnership(req, options = {}) {
  const {
    allowAssignedTo = true,
    fallbackAssignedTo = null
  } = options;
  const actor = req.user;

  if (!actor?.id) {
    const error = new Error("Authenticated user context is required.");
    error.status = 401;
    throw error;
  }

  const requestedAssignedTo = String(req.body?.assigned_to || req.body?.assignedTo || "").trim() || null;
  let assignedTo = fallbackAssignedTo || actor.id;

  if (allowAssignedTo) {
    if (normalizeRole(actor.role) === "agent") {
      assignedTo = actor.id;
    } else if (requestedAssignedTo) {
      const allowed = await canAssignWithinOrg(actor, requestedAssignedTo);
      if (!allowed) {
        const error = new Error("Assigned user must belong to the same organization.");
        error.status = 400;
        error.code = "ASSIGNED_USER_OUTSIDE_ORG";
        throw error;
      }

      assignedTo = requestedAssignedTo;
    }
  }

  return {
    organization_id: actor.organization_id || null,
    created_by: actor.id,
    ...(allowAssignedTo ? { assigned_to: assignedTo || actor.id } : {})
  };
}

module.exports = {
  canAssignWithinOrg,
  getRequestUserContext,
  isSuperAdmin,
  normalizeRole,
  requireRole,
  resolveInsertOwnership
};
