import React from "react"
import { Library, MicVocal, Music, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { TabId } from "@/types/music2vec"

type AppNavigationProps = {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  mobile?: boolean
}

type NavItem = {
  id: TabId
  label: string
  mobileLabel: string
  icon: React.ElementType
}

const navItems: NavItem[] = [
  { id: "library", label: "My Library", mobileLabel: "Library", icon: Library },
  { id: "song", label: "Find Similar", mobileLabel: "Similar", icon: Music },
  { id: "text", label: "Text Search", mobileLabel: "Text", icon: MicVocal },
  { id: "upload", label: "Upload Music", mobileLabel: "Upload", icon: Plus },
]

function NavButton({
  isActive,
  label,
  icon: Icon,
  onClick,
}: {
  isActive: boolean
  label: string
  icon: React.ElementType
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
        isActive
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800/50"
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )
}

export function AppNavigation({ activeTab, onTabChange, mobile = false }: AppNavigationProps) {
  if (mobile) {
    return (
      <div className="md:hidden flex overflow-x-auto gap-2 pb-6 mb-6 border-b hide-scrollbar">
        {navItems.map((item) => (
          <NavButton
            key={item.id}
            isActive={activeTab === item.id}
            label={item.mobileLabel}
            icon={item.icon}
            onClick={() => onTabChange(item.id)}
          />
        ))}
      </div>
    )
  }

  return (
    <aside className="w-64 shrink-0 bg-white/50 dark:bg-slate-900/50 border-r flex flex-col pt-6 hidden md:flex">
      <div className="px-4 pb-4">
        <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Menu</p>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <NavButton
              key={item.id}
              isActive={activeTab === item.id}
              label={item.label}
              icon={item.icon}
              onClick={() => onTabChange(item.id)}
            />
          ))}
        </nav>
      </div>
    </aside>
  )
}
