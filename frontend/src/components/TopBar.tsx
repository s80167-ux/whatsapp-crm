type TopBarProps = {
  activeContactName: string | null;
  openChats: number;
  responseRate: number;
  selectedPhone: string | null;
  syncedMessages: number;
};

export function TopBar({ activeContactName, openChats, responseRate, selectedPhone, syncedMessages }: TopBarProps) {
  const stats = [
    { label: "Open chats", value: `${openChats}` },
    { label: "Response rate", value: `${responseRate}%` },
    { label: "Synced messages", value: `${syncedMessages}` },
    { label: "Active contact", value: activeContactName || selectedPhone || "None" }
  ];

  return (
    <div className="glass-panel grid gap-2 border border-white/70 bg-white/58 p-3 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-[24px] border border-white/60 bg-white/72 px-4 py-3 shadow-soft">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800/65">{stat.label}</p>
          <p className="mt-1.5 truncate text-lg font-semibold text-ink">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
