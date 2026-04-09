import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { CheckSquare, Home, PieChart, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { path: "/", label: "Homebase", icon: Home },
  { path: "/tasks", label: "Tasks", icon: CheckSquare },
  { path: "/finances", label: "Finances", icon: PieChart },
  { path: "/settings", label: "Settings", icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Mobile Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border/50 pb-safe">
        <div className="flex items-center justify-around p-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path;
            return (
              <Link key={item.path} href={item.path}>
                <div
                  className={cn(
                    "flex flex-col items-center justify-center w-16 h-14 rounded-xl transition-all",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:bg-accent/50"
                  )}
                >
                  <Icon className="w-5 h-5 mb-1" strokeWidth={isActive ? 2.5 : 2} />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 left-0 z-50 bg-card border-r border-border/50">
        <div className="p-6">
          <h1 className="text-xl font-serif text-foreground font-semibold tracking-tight">Homebase</h1>
        </div>
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path;
            return (
              <Link key={item.path} href={item.path}>
                <div
                  className={cn(
                    "flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all group cursor-pointer",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <Icon
                    className={cn(
                      "w-4 h-4 mr-3 transition-transform group-hover:scale-110",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                    )}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 pb-20 md:pb-0">
        <div className="max-w-5xl mx-auto min-h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
