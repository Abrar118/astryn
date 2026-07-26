import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { gooeyToast } from "goey-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  clearLlmConfig,
  errorText,
  getLlmConfig,
  setLlmConfig,
  testLlmConnection,
} from "@/lib/commands";
import { SectionHeader } from "../SectionHeader";

export function AiSection() {
  const qc = useQueryClient();
  // AI endpoint (report generators). URL/model prefill from the saved config
  // (null local state = "not edited yet"); the API key is paste-once like the
  // other secrets — cleared from state immediately and never echoed back.
  const { data: llmCfg } = useQuery({ queryKey: ["llm-config"], queryFn: getLlmConfig });
  const [llmUrl, setLlmUrl] = useState<string | null>(null);
  const [llmModel, setLlmModel] = useState<string | null>(null);
  const [llmKeyInput, setLlmKeyInput] = useState("");
  const [llmSaving, setLlmSaving] = useState(false);
  const invalidateLlm = () => qc.invalidateQueries({ queryKey: ["llm-config"] });

  const llmTestMut = useMutation({
    mutationFn: () => testLlmConnection(),
    onSuccess: (models) =>
      gooeyToast.success(`Endpoint OK — ${models.length} model${models.length === 1 ? "" : "s"} available`),
    onError: (err) => gooeyToast.error("Endpoint test failed", { description: errorText(err) }),
  });
  const llmClearMut = useMutation({
    mutationFn: () => clearLlmConfig(),
    onSuccess: () => {
      setLlmUrl(null);
      setLlmModel(null);
      gooeyToast.success("AI endpoint cleared");
      invalidateLlm();
    },
    onError: (err) => gooeyToast.error("Could not clear the endpoint", { description: errorText(err) }),
  });
  const llmBusy = llmSaving || llmTestMut.isPending || llmClearMut.isPending;

  // Direct async (not a TanStack mutation) so the key never enters the mutation cache.
  const handleLlmSave = async (e: FormEvent) => {
    e.preventDefault();
    if (llmBusy) return;
    const baseUrl = (llmUrl ?? llmCfg?.baseUrl ?? "").trim();
    const model = (llmModel ?? llmCfg?.model ?? "").trim();
    if (!baseUrl || !model) return;
    const key = llmKeyInput.trim() || null;
    setLlmKeyInput(""); // clear the secret from component state immediately
    setLlmSaving(true);
    try {
      await setLlmConfig(baseUrl, model, key);
      gooeyToast.success("AI endpoint saved");
      invalidateLlm();
    } catch (err) {
      gooeyToast.error("Could not save the endpoint", { description: errorText(err) });
    } finally {
      setLlmSaving(false);
    }
  };

  return (
    <>
      <SectionHeader
        title="AI"
        description="An OpenAI-compatible endpoint that writes up your generated reports."
      />
      <Card className="flex flex-col gap-4 p-6">
        <p className="text-sm text-muted-foreground">
          {llmCfg === undefined
            ? "Checking…"
            : llmCfg === null
              ? "No AI endpoint — reports show plain facts"
              : `${llmCfg.model} @ ${llmCfg.baseUrl}${llmCfg.hasApiKey ? " · key saved" : ""}`}
        </p>
        <form className="flex flex-col gap-3" onSubmit={handleLlmSave}>
          <Label htmlFor="llm-url">AI endpoint (OpenAI-compatible)</Label>
          <Input
            id="llm-url"
            type="text"
            autoComplete="off"
            placeholder="http://localhost:11434"
            value={llmUrl ?? llmCfg?.baseUrl ?? ""}
            onChange={(e) => setLlmUrl(e.currentTarget.value)}
            disabled={llmBusy}
          />
          <Label htmlFor="llm-model">Model</Label>
          <Input
            id="llm-model"
            type="text"
            autoComplete="off"
            placeholder="phi4-mini-reasoning:latest"
            value={llmModel ?? llmCfg?.model ?? ""}
            onChange={(e) => setLlmModel(e.currentTarget.value)}
            disabled={llmBusy}
          />
          <Label htmlFor="llm-key">API key (optional)</Label>
          <Input
            id="llm-key"
            type="password"
            autoComplete="off"
            placeholder="Not needed for Ollama"
            value={llmKeyInput}
            onChange={(e) => setLlmKeyInput(e.currentTarget.value)}
            disabled={llmBusy}
          />
          <p className="text-xs text-muted-foreground">
            Powers the Reports generators (Ollama, LM Studio, vLLM, OpenAI…). The key is stored in
            the system keychain and never shown again.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={llmBusy}>Save endpoint</Button>
            <Button type="button" variant="secondary" disabled={llmBusy} onClick={() => llmTestMut.mutate()}>
              Test connection
            </Button>
            <Button type="button" variant="ghost" disabled={llmBusy} onClick={() => llmClearMut.mutate()}>
              Clear
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
