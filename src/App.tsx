import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
import { AppShell } from "@/components/AppShell";

function App() {
  return (
    <>
      <AppShell />
      <GooeyToaster position="top-center" theme="dark" showProgress closeButton="top-left" />
    </>
  );
}

export default App;
