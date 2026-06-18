import { useState } from "react";
import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
import { Home } from "@/features/home/Home";
import { Settings } from "@/features/settings/Settings";

type View = "home" | "settings";

function App() {
  const [view, setView] = useState<View>("home");
  return (
    <div className="min-h-screen bg-background text-foreground">
      {view === "home" ? (
        <Home onOpenSettings={() => setView("settings")} />
      ) : (
        <Settings onBack={() => setView("home")} />
      )}
      <GooeyToaster position="bottom-right" />
    </div>
  );
}

export default App;
