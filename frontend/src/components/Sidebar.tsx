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
  whatsAppStatus: WhatsAppStatus | null;
  whatsAppQr: WhatsAppQr | null;
  loadingWhatsApp: boolean;
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
  whatsAppStatus,
  whatsAppQr,
  loadingWhatsApp
}: SidebarProps) {
  return (
    <aside className="glass-panel flex h-full flex-col justify-between p-4">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-white/70 text-base font-semibold text-ink shadow-soft">
            W
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Workspace</p>
            <h2 className="text-base font-semibold text-ink">whatsapp-crm</h2>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          {menu.map((item) => (
            <button
              key={item.key}
              className={`flex w-full items-center justify-between rounded-[22px] border px-4 py-3 text-left text-sm font-medium transition ${
                activeView === item.key
                  ? "border-white/70 bg-white/70 text-ink shadow-soft"
                  : "border-white/40 bg-white/25 text-slate-700 hover:bg-white/50"
              }`}
              onClick={() => onChangeView(item.key as "inbox" | "pipeline" | "broadcast")}
              type="button"
            >
              <span>{item.label}</span>
              <span className="rounded-full bg-white/80 px-2 py-1 text-xs text-slate-500">
                {counts[item.key as keyof typeof counts]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 pt-4">
        <WhatsAppConnectCard compact loading={loadingWhatsApp} qr={whatsAppQr} status={whatsAppStatus} />

        <div className="rounded-[28px] border border-white/50 bg-white/40 p-4 shadow-soft">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Signed in</p>
          <p className="mt-2 truncate text-sm font-medium text-ink">{userEmail}</p>
          <button className="secondary-button mt-3 w-full" onClick={onLogout} type="button">
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}
