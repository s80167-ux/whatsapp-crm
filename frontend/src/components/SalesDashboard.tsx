import { useMemo, useState, type ReactNode } from "react";
import { CUSTOMER_STATUS_LABELS, type Conversation, type CustomerStatus, type SalesLeadItem } from "../lib/api";
import { formatPhoneDisplay, getConversationIdentifier } from "../lib/display";
import { SalesFunnelChart, type FunnelStage } from "./SalesFunnelChart";
import { SalesPerformanceChart, type MonthlySalesPoint } from "./SalesPerformanceChart";

type SalesDashboardProps = {
  activeContact: string;
  conversations: Conversation[];
  loading?: boolean;
  onRefresh?: () => void;
  onOpenConversation?: (params: { phone: string; chatJid?: string | null; messageId?: string | null }) => void;
  salesLeadItems: SalesLeadItem[];
};

type SalesRow = {
  id: string;
  customer: string;
  opportunity: string;
  status: CustomerStatus;
  value: number;
  price: number;
  quantity: number;
  createdAt: string;
  messageId: string;
  phone: string;
  chatJid: string | null;
  packageName: string;
  productType: string;
};

type CustomerRow = {
  customer: string;
  productType: string;
  packageName: string;
  price: number;
  quantity: number;
  total: number;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0
  }).format(value);
}

function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getSalesId(index: number, id: string) {
  return `S${String(index + 1).padStart(4, "0")}-${id.slice(0, 4).toUpperCase()}`;
}

function getStatusPillClasses(status: CustomerStatus) {
  switch (status) {
    case "new_lead":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "interested":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "processing":
      return "bg-sky-100 text-sky-800 border-sky-200";
    case "closed_won":
      return "bg-emerald-200 text-emerald-900 border-emerald-200";
    case "closed_lost":
      return "bg-slate-200 text-slate-800 border-slate-300";
    default:
      return "bg-whatsapp-soft text-whatsapp-deep border-whatsapp-line";
  }
}

function SalesTableCard({
  title,
  children,
  action
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="glass-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-whatsapp-line px-3 py-3 sm:px-4">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        {action ?? null}
      </div>
      {children}
    </section>
  );
}

function groupByMonth(rows: SalesRow[]): MonthlySalesPoint[] {
  const now = new Date();
  const monthKeys = Array.from({ length: 6 }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - offset), 1);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date),
      value: 0
    };
  });
  const monthMap = new Map(monthKeys.map((month) => [month.key, month]));

  for (const row of rows) {
    const date = new Date(row.createdAt);
    const month = monthMap.get(`${date.getFullYear()}-${date.getMonth()}`);

    if (month) {
      month.value += row.value;
    }
  }

  return monthKeys.map((month) => ({
    month: month.label,
    value: month.value
  }));
}

function groupByCustomer(rows: SalesRow[]): CustomerRow[] {
  const map = new Map<string, CustomerRow>();

  for (const row of rows) {
    const existing = map.get(row.customer);

    if (!existing) {
      map.set(row.customer, {
        customer: row.customer,
        productType: row.productType,
        packageName: row.packageName,
        price: row.price,
        quantity: row.quantity,
        total: row.value
      });
      continue;
    }

    existing.quantity += row.quantity;
    existing.total += row.value;
    existing.price = row.price;
  }

  return Array.from(map.values());
}

function getMonthLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(value));
}

const funnelStatusOrder: CustomerStatus[] = ["new_lead", "interested", "processing", "closed_won", "closed_lost"];

const funnelStatusColors: Record<CustomerStatus, string> = {
  new_lead: "#f2c14e",
  interested: "#66bb6a",
  processing: "#64b5f6",
  closed_won: "#5f7f9f",
  closed_lost: "#d8dee5"
};

function mapStageNameToStatus(stageName: string): CustomerStatus | null {
  for (const status of funnelStatusOrder) {
    if (CUSTOMER_STATUS_LABELS[status] === stageName) {
      return status;
    }
  }

  return null;
}

export function SalesDashboard({ activeContact, conversations, loading = false, onRefresh, onOpenConversation, salesLeadItems }: SalesDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | "all">("all");
  const [activeFunnelStage, setActiveFunnelStage] = useState<string | null>(null);
  const [activeMonth, setActiveMonth] = useState<string | null>(null);

  const conversationMap = useMemo(() => {
    const map = new Map<string, Conversation>();

    for (const conversation of conversations) {
      const identifier = getConversationIdentifier(conversation.phone, conversation.chatJid);
      if (identifier) {
        map.set(identifier, conversation);
      }
    }

    return map;
  }, [conversations]);

  const rows = useMemo<SalesRow[]>(() => {
    return salesLeadItems.map((item, index) => {
      const conversation = conversationMap.get(getConversationIdentifier(item.phone, item.chat_jid) || "") || null;
      const status = item.lead_status || conversation?.status || "new_lead";
      const customer = conversation?.contactName || formatPhoneDisplay(item.phone, item.chat_jid);

      return {
        id: getSalesId(index, item.id),
        customer,
        opportunity: [item.product_type, item.package_name].filter(Boolean).join(" - "),
        status,
        value: item.price * item.quantity,
        price: item.price,
        quantity: item.quantity,
        createdAt: item.updated_at || item.created_at,
        messageId: item.message_id,
        phone: item.phone,
        chatJid: item.chat_jid || null,
        packageName: item.package_name,
        productType: item.product_type
      };
    });
  }, [conversationMap, salesLeadItems]);

  const interactionRows = useMemo(() => {
    return rows.filter((row) => {
      const stageStatus = activeFunnelStage ? mapStageNameToStatus(activeFunnelStage) : null;

      if (stageStatus && row.status !== stageStatus) {
        return false;
      }

      if (activeMonth && getMonthLabel(row.createdAt) !== activeMonth) {
        return false;
      }

      return true;
    });
  }, [activeFunnelStage, activeMonth, rows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return interactionRows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [row.id, row.customer, row.opportunity, row.phone, CUSTOMER_STATUS_LABELS[row.status]]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [interactionRows, searchQuery, statusFilter]);

  const totalRevenue = useMemo(() => interactionRows.reduce((sum, row) => sum + row.value, 0), [interactionRows]);
  const wonCount = useMemo(() => interactionRows.filter((row) => row.status === "closed_won").length, [interactionRows]);
  const conversionRate = interactionRows.length ? Math.round((wonCount / interactionRows.length) * 100) : 0;
  const activeCustomers = useMemo(() => new Set(interactionRows.map((row) => row.customer)).size, [interactionRows]);
  const groupedByCustomer = useMemo(() => groupByCustomer(filteredRows), [filteredRows]);
  const monthlyPoints = useMemo(() => groupByMonth(activeFunnelStage ? filteredRows : interactionRows), [activeFunnelStage, filteredRows, interactionRows]);

  const funnelStages = useMemo<FunnelStage[]>(() => {
    const sourceRows = activeMonth ? interactionRows : rows;
    const countsByStatus: Record<CustomerStatus, number> = {
      new_lead: 0,
      interested: 0,
      processing: 0,
      closed_won: 0,
      closed_lost: 0
    };

    for (const row of sourceRows) {
      countsByStatus[row.status] += 1;
    }

    const total = Math.max(sourceRows.length, 1);

    return funnelStatusOrder.map((status) => {
      const count = countsByStatus[status];
      return {
        name: CUSTOMER_STATUS_LABELS[status],
        count,
        percent: Math.round((count / total) * 100),
        color: funnelStatusColors[status]
      };
    });
  }, [activeMonth, interactionRows, rows]);

  const revenueGrowth = Math.min(100, Math.max(0, conversionRate + 10));

  return (
    <section className="space-y-3 xl:grid xl:grid-cols-[minmax(0,1fr)_330px] xl:items-start xl:gap-3">
      <div className="mt-2 flex flex-col space-y-3 sm:mt-4">
        <section className="glass-panel space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-whatsapp-muted">Sales Management</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Sales Overview</h2>
            </div>
            <button
              type="button"
              className="rounded-full border border-whatsapp-line bg-white px-3 py-1.5 text-xs font-semibold text-whatsapp-muted transition hover:text-whatsapp-deep disabled:opacity-60"
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-whatsapp-line bg-white px-3 py-2.5 shadow-soft">
              <p className="text-xs uppercase tracking-[0.18em] text-whatsapp-muted">Leads</p>
              <p className="mt-1 text-2xl font-semibold text-whatsapp-dark">{rows.length}</p>
              <p className="text-xs text-whatsapp-muted">{activeCustomers} customers</p>
            </div>
            <div className="rounded-xl border border-whatsapp-line bg-white px-3 py-2.5 shadow-soft">
              <p className="text-xs uppercase tracking-[0.18em] text-whatsapp-muted">Deals won</p>
              <p className="mt-1 text-2xl font-semibold text-whatsapp-dark">{wonCount}</p>
              <p className="text-xs text-whatsapp-muted">{conversionRate}% conversion</p>
            </div>
            <div className="rounded-xl border border-whatsapp-line bg-white px-3 py-2.5 shadow-soft">
              <p className="text-xs uppercase tracking-[0.18em] text-whatsapp-muted">Revenue</p>
              <p className="mt-1 text-2xl font-semibold text-whatsapp-dark">{formatCurrency(totalRevenue)}</p>
              <p className="text-xs text-whatsapp-muted">Live sales items</p>
            </div>
          </div>

          <SalesTableCard
            title="Sales by Sales ID"
            action={
              <button type="button" className="rounded-full border border-whatsapp-line bg-white px-3 py-1.5 text-xs font-semibold text-whatsapp-muted transition hover:text-whatsapp-deep sm:px-4 sm:py-2 sm:text-sm sm:font-medium">
                Export
                <span className="ml-2 inline-block">v</span>
              </button>
            }
          >
            <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-4">
              <div className="min-w-0 w-full flex-1">
                <input
                  className="input-glass h-10 text-sm"
                  placeholder="Search sales..."
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </div>
              <select className="input-glass h-10 w-full text-sm sm:max-w-[220px]" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CustomerStatus | "all")}>
                <option value="all">Status</option>
                {Object.entries(CUSTOMER_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 px-3 pb-3 sm:hidden">
              {filteredRows.length === 0 ? (
                <p className="rounded-lg border border-whatsapp-line bg-white px-3 py-4 text-sm text-whatsapp-muted">
                  No sales items match your current search.
                </p>
              ) : (
                filteredRows.map((row) => (
                  <article key={row.id} className="rounded-xl border border-whatsapp-line bg-white p-3 shadow-soft">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {onOpenConversation ? (
                          <button
                            type="button"
                            className="rounded px-1 py-0.5 text-left text-sm font-semibold text-whatsapp-deep underline-offset-2 transition hover:text-whatsapp-dark hover:underline"
                            onClick={() => onOpenConversation({ phone: row.phone, chatJid: row.chatJid, messageId: row.messageId })}
                          >
                            {row.id}
                          </button>
                        ) : (
                          <p className="text-sm font-semibold text-ink">{row.id}</p>
                        )}
                        <p className="mt-0.5 text-sm font-medium text-ink">{row.customer}</p>
                      </div>
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${getStatusPillClasses(row.status)}`}>
                        {CUSTOMER_STATUS_LABELS[row.status]}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-whatsapp-muted">{row.opportunity}</p>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="font-semibold text-ink">{formatCurrency(row.value)}</span>
                      <span className="text-whatsapp-muted">{formatCompactDate(row.createdAt)}</span>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="bg-[#f4f0ec] text-left text-whatsapp-muted">
                    <th className="px-4 py-2.5 font-medium">Sales ID</th>
                    <th className="px-4 py-2.5 font-medium">Customer</th>
                    <th className="px-4 py-2.5 font-medium">Opportunity</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Value</th>
                    <th className="px-4 py-2.5 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-sm text-whatsapp-muted" colSpan={6}>
                        No sales items match your current search.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => (
                      <tr key={row.id} className="border-t border-whatsapp-line/60 bg-white transition hover:bg-whatsapp-soft/40">
                        <td className="border-t border-whatsapp-line/60 px-4 py-3 font-semibold text-ink">
                          {onOpenConversation ? (
                            <button
                              type="button"
                              className="rounded px-1 py-0.5 text-left text-whatsapp-deep underline-offset-2 transition hover:text-whatsapp-dark hover:underline"
                              onClick={() => onOpenConversation({ phone: row.phone, chatJid: row.chatJid, messageId: row.messageId })}
                            >
                              {row.id}
                            </button>
                          ) : (
                            row.id
                          )}
                        </td>
                        <td className="border-t border-whatsapp-line/60 px-4 py-3 font-medium text-ink">{row.customer}</td>
                        <td className="border-t border-whatsapp-line/60 px-4 py-3 text-whatsapp-muted">{row.opportunity}</td>
                        <td className="border-t border-whatsapp-line/60 px-4 py-3">
                          <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${getStatusPillClasses(row.status)}`}>
                            {CUSTOMER_STATUS_LABELS[row.status]}
                          </span>
                        </td>
                        <td className="border-t border-whatsapp-line/60 px-4 py-3 font-medium text-ink">{formatCurrency(row.value)}</td>
                        <td className="border-t border-whatsapp-line/60 px-4 py-3 text-xs text-whatsapp-muted">{formatCompactDate(row.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SalesTableCard>

          <SalesTableCard title="Sales by Contact Name">
            <div className="space-y-2 px-3 pb-3 sm:hidden">
              {groupedByCustomer.length === 0 ? (
                <p className="rounded-lg border border-whatsapp-line bg-white px-3 py-4 text-sm text-whatsapp-muted">
                  No contact-level sales data available yet.
                </p>
              ) : (
                groupedByCustomer.map((row) => (
                  <article key={`${row.customer}-${row.packageName}`} className="rounded-xl border border-whatsapp-line bg-white p-3 shadow-soft">
                    <p className="text-sm font-semibold text-ink">{row.customer}</p>
                    <p className="mt-1 text-xs text-whatsapp-muted">{row.productType} - {row.packageName}</p>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-whatsapp-muted">Price</p>
                        <p className="font-semibold text-ink">{formatCurrency(row.price)}</p>
                      </div>
                      <div>
                        <p className="text-whatsapp-muted">Qty</p>
                        <p className="font-semibold text-ink">{row.quantity}</p>
                      </div>
                      <div>
                        <p className="text-whatsapp-muted">Total</p>
                        <p className="font-semibold text-ink">{formatCurrency(row.total)}</p>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="bg-[#f4f0ec] text-left text-whatsapp-muted">
                    <th className="px-4 py-2.5 font-medium">Contact Name</th>
                    <th className="px-4 py-2.5 font-medium">Product Type</th>
                    <th className="px-4 py-2.5 font-medium">Package Name</th>
                    <th className="px-4 py-2.5 font-medium">Price</th>
                    <th className="px-4 py-2.5 font-medium">Qty</th>
                    <th className="px-4 py-2.5 font-medium">Total RM</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedByCustomer.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-sm text-whatsapp-muted" colSpan={6}>
                        No contact-level sales data available yet.
                      </td>
                    </tr>
                  ) : (
                    groupedByCustomer.map((row) => (
                      <tr key={`${row.customer}-${row.packageName}`} className="border-t border-whatsapp-line/60 bg-white transition hover:bg-whatsapp-soft/40">
                        <td className="border-t border-whatsapp-line/60 px-4 py-3 font-medium text-ink">{row.customer}</td>
                        <td className="border-t border-whatsapp-line/60 px-4 py-3 text-whatsapp-muted">{row.productType}</td>
                        <td className="border-t border-whatsapp-line/60 px-4 py-3 text-whatsapp-muted">{row.packageName}</td>
                        <td className="border-t border-whatsapp-line/60 px-4 py-3 font-medium text-ink">{formatCurrency(row.price)}</td>
                        <td className="border-t border-whatsapp-line/60 px-4 py-3 font-medium text-ink">{row.quantity}</td>
                        <td className="border-t border-whatsapp-line/60 px-4 py-3 font-semibold text-ink">{formatCurrency(row.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </SalesTableCard>
        </section>
      </div>

      <div className="space-y-3">
        <SalesFunnelChart
          stages={funnelStages}
          activeStage={activeFunnelStage}
          onSelectStage={(stage) => {
            setActiveFunnelStage(stage);
            const selectedStatus = stage ? mapStageNameToStatus(stage) : null;
            setStatusFilter(selectedStatus ?? "all");
          }}
        />

        <section className="glass-panel p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-2 rounded-xl border border-whatsapp-line bg-white/70 p-2.5 text-center sm:grid-cols-3">
            <div className="space-y-1">
              <p className="text-xl font-semibold text-whatsapp-dark">{rows.length}</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-whatsapp-muted">Leads</p>
            </div>
            <div className="space-y-1">
              <p className="text-xl font-semibold text-whatsapp-dark">{wonCount}</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-whatsapp-muted">Deals won</p>
            </div>
            <div className="space-y-1">
              <p className="text-xl font-semibold text-whatsapp-dark">{conversionRate}%</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-whatsapp-muted">Conv. rate</p>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-whatsapp-line bg-white px-3 py-3 shadow-soft">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-whatsapp-muted">Revenue</p>
                <h3 className="mt-1 text-2xl font-semibold text-ink">{formatCurrency(totalRevenue)}</h3>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                +{revenueGrowth}%
              </span>
            </div>
            <p className="mt-1 text-xs text-whatsapp-muted">Current contact: {activeContact}</p>
          </div>

          <div className="mt-3">
            <SalesPerformanceChart
              points={monthlyPoints}
              activeMonth={activeMonth}
              onSelectMonth={(month) => setActiveMonth(month)}
            />
          </div>

          <div className="mt-3">
            <p className="text-base font-semibold text-ink">Sales Reports</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className="group rounded-xl border border-whatsapp-line bg-white p-2.5 text-left shadow-soft transition hover:-translate-y-0.5 hover:bg-whatsapp-soft">
                <div className="rounded-xl bg-emerald-50 p-3">
                  <svg viewBox="0 0 72 40" className="h-10 w-full text-emerald-500" fill="none">
                    <path d="M3 31 22 24 34 28 48 14 68 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 36h66" stroke="currentColor" strokeOpacity="0.2" />
                    <rect x="7" y="22" width="7" height="12" rx="2" fill="currentColor" fillOpacity="0.25" />
                    <rect x="19" y="18" width="7" height="16" rx="2" fill="currentColor" fillOpacity="0.35" />
                    <rect x="31" y="14" width="7" height="20" rx="2" fill="currentColor" fillOpacity="0.45" />
                    <rect x="43" y="10" width="7" height="24" rx="2" fill="currentColor" fillOpacity="0.55" />
                    <rect x="55" y="5" width="7" height="29" rx="2" fill="currentColor" fillOpacity="0.65" />
                  </svg>
                </div>
                <p className="mt-2 text-center text-sm font-semibold text-ink">Sales Performance</p>
              </button>

              <button type="button" className="group rounded-xl border border-whatsapp-line bg-white p-2.5 text-left shadow-soft transition hover:-translate-y-0.5 hover:bg-whatsapp-soft">
                <div className="rounded-xl bg-teal-50 p-3">
                  <svg viewBox="0 0 72 40" className="h-10 w-full text-teal-500" fill="none">
                    <circle cx="24" cy="20" r="12" fill="currentColor" fillOpacity="0.25" />
                    <path d="M24 8a12 12 0 0 1 12 12H24Z" fill="currentColor" fillOpacity="0.55" />
                    <path d="M36 20a12 12 0 0 1-12 12v-12Z" fill="currentColor" fillOpacity="0.42" />
                    <path d="M24 32a12 12 0 0 1-10.4-6l10.4-6Z" fill="currentColor" fillOpacity="0.32" />
                    <path d="M24 8a12 12 0 0 1 10.4 6L24 20Z" fill="currentColor" fillOpacity="0.75" />
                  </svg>
                </div>
                <p className="mt-2 text-center text-sm font-semibold text-ink">Conversion Rates</p>
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
