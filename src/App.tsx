import { Routes, Route, Navigate } from "react-router-dom";
import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
import { AppShell } from "@/components/AppShell";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { Settings } from "@/features/settings/Settings";

function App() {
  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<CalendarPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <GooeyToaster position="bottom-right" />
    </>
  );
}

export default App;
