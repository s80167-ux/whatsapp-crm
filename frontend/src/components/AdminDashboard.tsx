import { useEffect, useState } from "react";
import { api, type Conversation, type CustomerStatus, type OrganizationInvitation, type UserProfile, type WhatsAppAccount } from "../lib/api";

type AdminDashboardProps = {
  organizationName: string;
  profile: UserProfile | null;
  conversations: Conversation[];
  salesStatuses: Record<CustomerStatus, number>;
  token: string;
  whatsAppAccounts: WhatsAppAccount[];
};

type MetricCard = {
  label: string;
  value: string;
  helper: string;
};

type ToolCard = {
  title: string;
  description: string;
  format: string;
};

type TaskItem = {
  title: string;
  detail: string;
  priority: "High" | "Medium" | "Low";
};

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function buildMetrics(
  conversations: Conversation[],
  whatsAppAccounts: WhatsAppAccount[],
  salesStatuses: Record<CustomerStatus, number>
): MetricCard[] {
  const unreadMessages = conversations.reduce((total, conversation) => total + Number(conversation.unreadCount || 0), 0);
  const activeConversations = conversations.filter((conversation) => conversation.lastDirection).length;
  const connectedAccounts = whatsAppAccounts.filter((account) => account.connection_state === "open").length;
  const atRiskLeads = salesStatuses.new_lead + salesStatuses.interested;

  return [
    {
      label: "Org conversations",
      value: formatCompactNumber(conversations.length),
      helper: `${formatCompactNumber(activeConversations)} active threads`
    },
    {
      label: "Unread messages",
      value: formatCompactNumber(unreadMessages),
      helper: "Needs same-day follow-up"
    },
    {
      label: "Connected channels",
      value: `${connectedAccounts}/${whatsAppAccounts.length || 0}`,
      helper: "WhatsApp accounts online"
    },
    {
      label: "Leads needing action",
      value: formatCompactNumber(atRiskLeads),
      helper: "New or interested pipeline"
    }
  ];
}

function buildTaskList(
  conversations: Conversation[],
  whatsAppAccounts: WhatsAppAccount[],
  organizationName: string
): TaskItem[] {
  const disconnectedAccounts = whatsAppAccounts.filter((account) => account.connection_state !== "open").length;
  const unreadConversations = conversations.filter((conversation) => Number(conversation.unreadCount || 0) > 0).length;

  return [
    {
      title: "Create invite flow",
      detail: `Add Team > Invite Member for ${organizationName} and generate invite code plus expiry.`,
      priority: "High"
    },
    {
      title: "Wire export endpoints",
      detail: "Connect CSV exports for customers, conversations, sales, and team activity.",
      priority: "High"
    },
    {
      title: "Review inbox coverage",
      detail: `${unreadConversations} conversations currently have unread messages that should be assigned.`,
      priority: "Medium"
    },
    {
      title: "Reconnect channels",
      detail: disconnectedAccounts
        ? `${disconnectedAccounts} WhatsApp account${disconnectedAccounts > 1 ? "s are" : " is"} not fully connected.`
        : "All WhatsApp accounts are connected.",
      priority: disconnectedAccounts ? "High" : "Low"
    }
  ];
}

const exportTools: ToolCard[] = [
  {
    title: "Customer export",
    description: "Pull customer names, phones, statuses, notes, and assignments for the current organization.",
    format: "CSV"
  },
  {
    title: "Conversation summary",
    description: "Export the latest conversation snapshot with unread count, last activity, and source account.",
    format: "CSV"
  },
  {
    title: "Sales pipeline",
    description: "Download lead stage totals and sales item records for reporting and finance reviews.",
    format: "CSV"
  },
  {
    title: "Team workload",
    description: "Prepare a manager report for agent ownership, queue depth, and response backlog.",
    format: "CSV"
  }
];

const inviteFlow = [
  "Open Team Management and click Invite Member.",
  "Select the member role and optional expiry window.",
  "Generate the invite code linked to the current organization.",
  "Share the invite code or link from the registration form."
];

export function AdminDashboard({
  organizationName,
  profile,
  conversations,
  salesStatuses,
  token,
  whatsAppAccounts
}: AdminDashboardProps) {
  const metrics = buildMetrics(conversations, whatsAppAccounts, salesStatuses);
  const tasks = buildTaskList(conversations, whatsAppAccounts, organizationName);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "agent" | "user">("agent");
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState(7);
  const [inviteError, setInviteError] = useState("");
  const [inviteNotice, setInviteNotice] = useState("");
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadInvitations() {
      if (!token) {
        return;
      }

      setInvitesLoading(true);
      setInviteError("");

      try {
        const data = await api.getOrganizationInvitations(token);
        if (!cancelled) {
          setInvitations(data);
        }
      } catch (error) {
        if (!cancelled) {
          setInviteError(error instanceof Error ? error.message : "Failed to load invitations.");
        }
      } finally {
        if (!cancelled) {
          setInvitesLoading(false);
        }
      }
    }

    void loadInvitations();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleCreateInvite() {
    setCreatingInvite(true);
    setInviteError("");
    setInviteNotice("");

    try {
      const invitation = await api.createOrganizationInvitation(
        {
          email: inviteEmail.trim() || null,
          role: inviteRole,
          expiresInDays: inviteExpiresInDays
        },
        token
      );

      setInvitations((current) => [invitation, ...current]);
      setInviteNotice(`Invite created. Share code ${invitation.invite_code} with the member.`);
      setInviteEmail("");
      setInviteRole("agent");
      setInviteExpiresInDays(7);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : "Failed to create invite.");
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleRevokeInvite(invitationId: string) {
    setRevokingInviteId(invitationId);
    setInviteError("");
    setInviteNotice("");

    try {
      await api.revokeOrganizationInvitation(invitationId, token);
      setInvitations((current) =>
        current.map((invitation) =>
          invitation.id === invitationId
            ? {
                ...invitation,
                status: "revoked"
              }
            : invitation
        )
      );
      setInviteNotice("Invite revoked.");
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : "Failed to revoke invite.");
    } finally {
      setRevokingInviteId(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="glass-panel overflow-hidden p-0">
        <div className="relative bg-[linear-gradient(135deg,#0f3b2b_0%,#1f6b4f_45%,#f0cf9c_100%)] px-6 py-7 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_40%)]" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/80">Admin Command Center</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{organizationName}</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/85">
                Use this view to monitor the organization, generate invite codes, and prepare exports for leadership,
                operations, and compliance.
              </p>
            </div>

            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/70">Signed in as</p>
              <p className="mt-1 text-sm font-semibold">{profile?.full_name || profile?.email || "Admin user"}</p>
              <p className="mt-1 text-xs text-white/80">{(profile?.role || "admin").replace(/_/g, " ")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <article key={metric.label} className="glass-panel p-5">
            <p className="text-[11px] uppercase tracking-[0.18em] text-whatsapp-muted">{metric.label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{metric.value}</p>
            <p className="mt-2 text-sm text-whatsapp-muted">{metric.helper}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <section className="glass-panel p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-whatsapp-muted">Invite Flow</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">Where admins create invite codes</h2>
            </div>
            <span className="rounded-full bg-[#e7f5ee] px-3 py-1 text-xs font-semibold text-whatsapp-deep">Team module</span>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {inviteFlow.map((step, index) => (
              <div key={step} className="rounded-2xl border border-whatsapp-line bg-white/80 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-whatsapp-muted">Step {index + 1}</p>
                <p className="mt-2 text-sm leading-6 text-ink">{step}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-whatsapp-line bg-white/80 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <label className="flex-1">
                <span className="mb-2 block text-sm font-medium text-whatsapp-deep">Member email</span>
                <input
                  className="input-glass w-full"
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="team.member@company.com"
                  type="email"
                  value={inviteEmail}
                />
              </label>
              <label className="lg:w-44">
                <span className="mb-2 block text-sm font-medium text-whatsapp-deep">Role</span>
                <select
                  className="input-glass w-full"
                  onChange={(event) => setInviteRole(event.target.value as "admin" | "agent" | "user")}
                  value={inviteRole}
                >
                  <option value="agent">Agent</option>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label className="lg:w-36">
                <span className="mb-2 block text-sm font-medium text-whatsapp-deep">Expiry</span>
                <select
                  className="input-glass w-full"
                  onChange={(event) => setInviteExpiresInDays(Number(event.target.value))}
                  value={inviteExpiresInDays}
                >
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </label>
              <button
                className="rounded-xl bg-whatsapp-deep px-4 py-3 text-sm font-semibold text-white transition hover:bg-whatsapp-dark disabled:cursor-not-allowed disabled:opacity-60"
                disabled={creatingInvite}
                onClick={handleCreateInvite}
                type="button"
              >
                {creatingInvite ? "Creating..." : "Generate invite"}
              </button>
            </div>

            {inviteError ? <p className="mt-3 text-sm text-rose-600">{inviteError}</p> : null}
            {inviteNotice ? <p className="mt-3 text-sm text-emerald-700">{inviteNotice}</p> : null}
          </div>
        </section>

        <section className="glass-panel p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-whatsapp-muted">Task List</p>
          <h2 className="mt-2 text-xl font-semibold text-ink">Implementation checklist</h2>
          <div className="mt-5 space-y-3">
            {tasks.map((task) => (
              <div key={task.title} className="rounded-2xl border border-whatsapp-line bg-white/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">{task.title}</p>
                  <span className="rounded-full bg-[#f8f5f2] px-2.5 py-1 text-[11px] font-semibold text-whatsapp-deep">
                    {task.priority}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-whatsapp-muted">{task.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <section className="glass-panel p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-whatsapp-muted">Export Center</p>
          <h2 className="mt-2 text-xl font-semibold text-ink">Admin extraction tools</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {exportTools.map((tool) => (
              <article key={tool.title} className="rounded-2xl border border-whatsapp-line bg-white/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">{tool.title}</p>
                  <span className="rounded-full bg-[#f0f2f5] px-2.5 py-1 text-[11px] font-semibold text-whatsapp-muted">
                    {tool.format}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-whatsapp-muted">{tool.description}</p>
                <button
                  className="mt-4 rounded-xl border border-whatsapp-line bg-[#f8f5f2] px-3 py-2 text-sm font-semibold text-whatsapp-deep transition hover:bg-[#efe8df]"
                  type="button"
                >
                  Prepare export
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="glass-panel p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-whatsapp-muted">Pending Invites</p>
          <h2 className="mt-2 text-xl font-semibold text-ink">Codes ready to share</h2>
          <div className="mt-5 space-y-3">
            {invitesLoading ? <p className="text-sm text-whatsapp-muted">Loading invitations...</p> : null}

            {!invitesLoading && !invitations.length ? (
              <div className="rounded-2xl border border-dashed border-whatsapp-line bg-white/80 p-4 text-sm text-whatsapp-muted">
                No invitations yet. Generate one above to onboard a new admin, agent, or user.
              </div>
            ) : null}

            {invitations.map((invitation) => (
              <div key={invitation.id} className="rounded-2xl border border-whatsapp-line bg-white/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{invitation.email || "Open invitation"}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-whatsapp-muted">{invitation.role}</p>
                  </div>
                  <span className="rounded-full bg-[#f8f5f2] px-2.5 py-1 text-[11px] font-semibold text-whatsapp-deep">
                    {invitation.status}
                  </span>
                </div>

                <div className="mt-3 rounded-xl bg-[#f8f5f2] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-whatsapp-muted">Invite code</p>
                  <p className="mt-1 text-sm font-semibold tracking-[0.18em] text-ink">{invitation.invite_code}</p>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-whatsapp-muted">
                  <p>Expires {new Date(invitation.expires_at).toLocaleDateString()}</p>
                  {invitation.status === "pending" ? (
                    <button
                      className="rounded-lg border border-whatsapp-line bg-white px-3 py-1.5 font-semibold text-whatsapp-deep transition hover:bg-[#f5f6f6] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={revokingInviteId === invitation.id}
                      onClick={() => handleRevokeInvite(invitation.id)}
                      type="button"
                    >
                      {revokingInviteId === invitation.id ? "Revoking..." : "Revoke"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="glass-panel p-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-whatsapp-muted">Pipeline Snapshot</p>
        <h2 className="mt-2 text-xl font-semibold text-ink">Lead mix across the organization</h2>
        <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-5">
          {Object.entries(salesStatuses).map(([status, count]) => (
            <div key={status} className="rounded-2xl border border-whatsapp-line bg-white/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold capitalize text-ink">{status.replace(/_/g, " ")}</p>
                <p className="text-lg font-semibold text-ink">{count}</p>
              </div>
              <div className="mt-3 h-2 rounded-full bg-[#edf1ef]">
                <div
                  className="h-2 rounded-full bg-[linear-gradient(90deg,#1f6b4f_0%,#f0cf9c_100%)]"
                  style={{
                    width: `${Math.min(
                      100,
                      conversations.length ? (count / Math.max(conversations.length, 1)) * 100 : count ? 100 : 0
                    )}%`
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
