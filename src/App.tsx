import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
import { AppShell } from "@/components/AppShell";
import { useScheme } from "@/lib/theme";

function App() {
  const scheme = useScheme();
  return (
    <>
      <AppShell />
      <GooeyToaster position="top-center" theme={scheme} showProgress closeButton="top-left" />
    </>
  );
}

export default App;
