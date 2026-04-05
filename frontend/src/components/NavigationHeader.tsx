type DashboardTab = "inbox" | "contacts";

type NavigationItem = {
  key: DashboardTab | "analytics" | "settings";
  label: string;
  disabled?: boolean;
};

const navItems: NavigationItem[] = [
  { key: "inbox", label: "Inbox" },
  { key: "contacts", label: "Contacts" },
  { key: "analytics", label: "Sales", disabled: true },
  { key: "settings", label: "Settings", disabled: true }
];

type NavigationHeaderProps = {
  activeTab: DashboardTab;
  onChangeTab: (tab: DashboardTab) => void;
};

export function NavigationHeader({ activeTab, onChangeTab }: NavigationHeaderProps) {
  return (
    <header className="glass-panel flex flex-col items-start gap-4 p-3 md:flex-row md:items-center md:justify-between lg:px-5">
      <div className="flex items-center gap-6 lg:gap-10">

        
        <nav className="flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-200 ${
                activeTab === item.key
                  ? "bg-[#f0f2f5] text-whatsapp-deep"
                  : item.disabled
                  ? "cursor-not-allowed text-whatsapp-muted/60"
                  : "text-whatsapp-muted hover:bg-[#f5f6f6] hover:text-whatsapp-deep"
              }`}
              disabled={item.disabled}
              onClick={() => {
                if (item.key === "inbox" || item.key === "contacts") {
                  onChangeTab(item.key);
                }
              }}
              type="button"
            >
              {getItemIcon(item.label)}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="hidden items-center gap-3 xl:flex">
        <div className="h-2 w-2 rounded-full bg-whatsapp-green animate-pulse" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-whatsapp-muted">System Live</span>
      </div>
    </header>
  );
}

function getItemIcon(label: string) {
  switch (label) {
    case "Inbox":
      return (
        <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      );
    case "Contacts":
      return (
        <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "Sales":
      return (
        <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
          <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
          <path d="M14 2v6h6" />
          <path d="M9 12h6" />
          <path d="M9 16h6" />
        </svg>
      );
    case "Settings":
      return (
        <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    default:
      return null;
  }
}
