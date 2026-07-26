import { gooeyToast } from "goey-toast";

export async function copyPrText(text: string, label: string): Promise<void> {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      textarea.remove();
    }
  }
  if (copied) {
    gooeyToast.success(`${label} copied`);
  } else {
    gooeyToast.error(`Couldn't copy ${label}`);
  }
}
