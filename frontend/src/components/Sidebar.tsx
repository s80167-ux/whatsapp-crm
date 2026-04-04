import logoGlass from "../../asset/rezeki_dashboard_logo_glass.png";
import type { WhatsAppQr, WhatsAppStatus } from "../lib/api";
import { WhatsAppConnectCard } from "./WhatsAppConnectCard";

type SidebarProps = {
  activeView: "inbox" | "pipeline" | "broadcast";
  counts: {
    inbox: number;
    pipeline: number;
    broadcast: number;
  };
  stats: {
    needsReply: number;
    hotLeads: number;
    currentThreadMessages: number;
    activeContact: string;
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
  stats,
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
    <aside className="glass-panel flex flex-col justify-between self-start border border-white/70 bg-white/58 p-3 xl:sticky xl:top-6">
      <div>
        <div className="flex items-center gap-3">
          <img
            alt="Rezeki Dashboard logo"
            className="h-16 w-auto object-contain"
            src={logoGlass}
          />
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-800/65">Workspace</p>
          </div>
        </div>

        <div className="mt-5 rounded-[26px] border border-white/60 bg-white/52 p-3 shadow-soft">
          <div className="grid grid-cols-2 gap-1.5">
            {menu.map((item) => (
              <button
                key={item.key}
                className={`relative min-w-0 rounded-[16px] border px-2.5 py-2 pr-9 text-left text-xs font-semibold transition ${
                  activeView === item.key
                    ? "border-emerald-200 bg-emerald-50/90 text-emerald-950 shadow-soft"
                    : "border-white/45 bg-white/35 text-emerald-950/82 hover:bg-white/60"
                }`}
                onClick={() => onChangeView(item.key as "inbox" | "pipeline" | "broadcast")}
                type="button"
              >
                <span className="block break-words leading-4">{item.label}</span>
                <span className="absolute right-2 top-2 rounded-full bg-emerald-950/6 px-1.5 py-0.5 text-[10px] text-emerald-900/60">
                  {counts[item.key as keyof typeof counts]}
                </span>
              </button>
            ))}

            <div className="rounded-[16px] border border-white/55 bg-white/72 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-900/50">Needs reply</p>
              <p className="mt-0.5 text-base font-semibold text-ink">{stats.needsReply}</p>
            </div>
            <div className="rounded-[16px] border border-white/55 bg-white/72 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-900/50">Hot leads</p>
              <p className="mt-0.5 text-base font-semibold text-ink">{stats.hotLeads}</p>
            </div>
            <div className="rounded-[16px] border border-white/55 bg-white/72 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-900/50">Thread msgs</p>
              <p className="mt-0.5 text-base font-semibold text-ink">{stats.currentThreadMessages}</p>
            </div>
            <div className="col-span-2 rounded-[16px] border border-white/55 bg-white/72 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-900/50">Active</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-ink">{stats.activeContact}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 pt-3 md:grid-cols-2 xl:grid-cols-1">
        <WhatsAppConnectCard
          compact
          disconnecting={disconnectingWhatsApp}
          loading={loadingWhatsApp}
          onDisconnect={onDisconnectWhatsApp}
          qr={whatsAppQr}
          status={whatsAppStatus}
        />

        <div className="flex flex-col rounded-[28px] border border-white/60 bg-white/62 p-4 shadow-soft">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800/65">Signed in</p>
          <p className="mt-2 break-all text-sm font-medium text-ink">{userEmail}</p>
          <button className="secondary-button mt-3 w-full sm:mt-auto" onClick={onLogout} type="button">
            Logout
          </button>
        </div>
      </div>
    </aside>
  );
}
