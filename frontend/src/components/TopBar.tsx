import { getDisplayPhone } from "../lib/display";

type TopBarProps = {
  activeContactName: string | null;
  activeChatJid?: string | null;
  openChats: number;
  responseRate: number;
  selectedPhone: string | null;
  syncedMessages: number;
};

export function TopBar({ activeContactName, activeChatJid, openChats, responseRate, selectedPhone, syncedMessages }: TopBarProps) {
  const stats = [
    { label: "Open chats", value: `${openChats}` },
    { label: "Response rate", value: `${responseRate}%` },
    { label: "Synced messages", value: `${syncedMessages}` },
    { label: "Active contact", value: activeContactName || getDisplayPhone(selectedPhone, activeChatJid) || "None" }
  ];

  return (
    <div className="glass-panel grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-[24px] border border-whatsapp-line bg-whatsapp-canvas px-4 py-3 shadow-soft">
          <p className="text-xs uppercase tracking-[0.25em] text-whatsapp-muted">{stat.label}</p>
          <p className="mt-1.5 truncate text-lg font-semibold text-ink">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
