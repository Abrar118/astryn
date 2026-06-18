import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  clearLinearKey,
  setLinearKey,
  testLinearConnection,
} from "@/lib/commands";

export function Settings({ onBack }: { onBack: () => void }) {
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);

  const invalidateStatus = () => qc.invalidateQueries({ queryKey: ["connection-status"] });

  // Save WITHOUT TanStack Query so the secret never enters the mutation cache.
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    setKeyInput(""); // clear the secret from component state immediately
    setSaving(true);
    try {
      await setLinearKey(key);
      gooeyToast.success("Linear key saved");
      invalidateStatus();
    } catch {
      gooeyToast.error("Could not save the key");
    } finally {
      setSaving(false);
    }
  };

  const testMut = useMutation({
    mutationFn: () => testLinearConnection(),
    onSuccess: (status) => {
      if (status.state === "connected") gooeyToast.success(`Connected as ${status.name}`);
      invalidateStatus();
    },
    onError: () => gooeyToast.error("Connection failed"),
  });

  const clearMut = useMutation({
    mutationFn: () => clearLinearKey(),
    onSuccess: () => {
      gooeyToast.success("Key cleared");
      invalidateStatus();
    },
    onError: () => gooeyToast.error("Could not clear the key"),
  });

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-10">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Settings</h1>
        <Button variant="outline" size="sm" onClick={onBack}>
          Back
        </Button>
      </header>

      <Card className="flex flex-col gap-4 p-6">
        <form className="flex flex-col gap-3" onSubmit={handleSave}>
          <Label htmlFor="linear-key">Linear personal API key</Label>
          <Input
            id="linear-key"
            type="password"
            autoComplete="off"
            placeholder="lin_api_…"
            value={keyInput}
            onChange={(e) => setKeyInput(e.currentTarget.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={saving}>
              Save
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={testMut.isPending}
              onClick={() => testMut.mutate()}
            >
              Test connection
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={clearMut.isPending}
              onClick={() => clearMut.mutate()}
            >
              Clear key
            </Button>
          </div>
        </form>
      </Card>
    </main>
  );
}
