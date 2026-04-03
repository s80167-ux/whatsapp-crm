import type { WhatsAppQr, WhatsAppStatus } from "../lib/api";
import { WhatsAppConnectCard } from "./WhatsAppConnectCard";

type SidebarProps = {
  activeView: "inbox" | "pipeline" | "broadcast";
  counts: {
    inbox: number;
    pipeline: number;
    broadcast: number;
  };
  onChangeView: (view: "inbox" | "pipeline" | "broadcast") => void;
  userEmail: string;
  onLogout: () => void;
  onDisconnectWhatsApp: () => void;
  whatsAppStatus: WhatsAppStatus | null;
  whatsAppQr: WhatsAppQr | null;
  loadingWhatsApp: boolean;
  disconnectingWhatsApp: boolean;
};

const menu = [
  { key: "inbox", label: "Inbox" },
  { key: "pipeline", label: "Pipeline" },
  { key: "broadcast", label: "Broadcast" }
];

export function Sidebar({
  activeView,
  counts,
  onChangeView,
  userEmail,
  onLogout,
  onDisconnectWhatsApp,
  whatsAppStatus,
  whatsAppQr,
  loadingWhatsApp,
  disconnectingWhatsApp
}: SidebarProps) {
  return (
    <aside className="glass-panel flex flex-col justify-between self-start border border-white/70 bg-white/58 p-4 xl:sticky xl:top-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-gradient-to-br from-emerald-500 to-teal-600 text-base font-semibold text-white shadow-soft">
            W
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-800/65">Workspace</p>
            <h2 className="text-base font-semibold text-ink">whatsapp-crm</h2>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          {menu.map((item) => (
            <button
              key={item.key}
              className={`flex w-full items-center justify-between rounded-[22px] border px-4 py-3 text-left text-sm font-medium transition ${
                activeView === item.key
                  ? "border-emerald-200 bg-emerald-50/90 text-emerald-950 shadow-soft"
                  : "border-white/45 bg-white/35 text-emerald-950/82 hover:bg-white/60"
              }`}
              onClick={() => onChangeView(item.key as "inbox" | "pipeline" | "broadcast")}
              type="button"
            >
              <span>{item.label}</span>
              <span className="rounded-full bg-emerald-950/6 px-2 py-1 text-xs text-emerald-900/60">
                {counts[item.key as keyof typeof counts]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 pt-4">
        <WhatsAppConnectCard
          compact
          disconnecting={disconnectingWhatsApp}
          loading={loadingWhatsApp}
          onDisconnect={onDisconnectWhatsApp}
          qr={whatsAppQr}
          status={whatsAppStatus}
        />

        <div className="rounded-[28px] border border-white/60 bg-white/62 p-4 shadow-soft">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800/65">Signed in</p>
          <p className="mt-2 truncate text-sm font-medium text-ink">{userEmail}</p>
          <button className="secondary-button mt-3 w-full" onClick={onLogout} type="button">
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}
