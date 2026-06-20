import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
import { AppShell } from "@/components/AppShell";

function App() {
  return (
    <>
      <AppShell />
      <GooeyToaster position="bottom-right" />
    </>
  );
}

export default App;
