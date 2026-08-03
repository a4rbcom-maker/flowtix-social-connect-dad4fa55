import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Edit2, Bot, X, Clock, Smartphone, MessageSquare, ToggleLeft, ToggleRight } from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Select } from "@/components/ui/dropdown";
import { toast } from "@/components/ui/toast";
import { LoadingState, EmptyState } from "@/components/ui/state";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/authProvider";
import { useWaKeywordRules, useWaAutomationMutations } from "@/hooks/useWaAutomation";
import { useWaSessions } from "@/hooks/useWaSessions";
import type { WaKeywordRule } from "@/types/wa-automation.types";

export function WaAutomationPage() {
  const { t } = useTranslation();
  const { session: authSession } = useAuth();
  const ws = authSession?.user?.id || "";
  const { data: rules, isLoading } = useWaKeywordRules();
  const muts = useWaAutomationMutations();
  const { data: sessions } = useWaSessions();
  const [showDialog, setShowDialog] = useState(false);
  const [editRule, setEditRule] = useState<WaKeywordRule | null>(null);

  const activeCount = rules?.filter((r) => r.is_active).length ?? 0;
  const inactiveCount = (rules?.length ?? 0) - activeCount;

  const handleToggle = (rule: WaKeywordRule) => {
    muts.toggleRule.mutate({ id: rule.id, active: !rule.is_active }, {
      onSuccess: () => toast({ type: "success", title: rule.is_active ? t("wa.automation.ruleDisabled") : t("wa.automation.ruleEnabled") }),
    });
  };

  const handleDelete = (rule: WaKeywordRule) => {
    if (!confirm(t("wa.automation.confirmDelete"))) return;
    muts.deleteRule.mutate(rule.id, {
      onSuccess: () => toast({ type: "success", title: t("wa.automation.ruleDeleted") }),
    });
  };

  const handleEdit = (rule: WaKeywordRule) => {
    setEditRule(rule);
    setShowDialog(true);
  };

  const handleCreate = () => {
    setEditRule(null);
    setShowDialog(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("wa.automation.title")}
        description={t("wa.automation.description")}
        icon={Bot}
      />

      {!isLoading && rules && rules.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label={t("wa.automation.totalRules")} value={rules.length} icon={MessageSquare} />
          <StatCard label={t("wa.automation.activeRules")} value={activeCount} icon={ToggleRight} />
          <StatCard label={t("wa.automation.inactiveRules")} value={inactiveCount} icon={ToggleLeft} />
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex-1" />
        <Button variant="primary" onClick={handleCreate}>
          <Plus size={16} />
          {t("wa.automation.addRule")}
        </Button>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : !rules?.length ? (
        <EmptyState
          title={t("wa.automation.noRules")}
          description={t("wa.automation.noRulesDesc")}
          icon={Bot}
          action={
            <Button variant="primary" onClick={handleCreate}>
              <Plus size={16} />
              {t("wa.automation.addRule")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              sessions={sessions ?? []}
              onToggle={() => handleToggle(rule)}
              onEdit={() => handleEdit(rule)}
              onDelete={() => handleDelete(rule)}
            />
          ))}
        </div>
      )}

      {showDialog && (
        <RuleDialog
          rule={editRule}
          open={showDialog}
          onClose={() => { setShowDialog(false); setEditRule(null); }}
          workspaceId={ws}
          sessions={sessions ?? []}
          onSave={(data) => {
            muts.saveRule.mutate(data as any, {
              onSuccess: () => {
                setShowDialog(false);
                setEditRule(null);
                toast({ type: "success", title: editRule ? t("wa.automation.ruleUpdated") : t("wa.automation.ruleCreated") });
              },
            });
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Rule Card
// ═══════════════════════════════════════════════════════════

function RuleCard({
  rule,
  sessions,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: WaKeywordRule;
  sessions: { id: string; name?: string | null; phone?: string | null; push_name?: string | null }[];
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const matchLabel = rule.match_type === "equals" ? t("wa.automation.matchEquals") :
    rule.match_type === "contains" ? t("wa.automation.matchContains") : rule.match_type;

  const session = rule.wa_session_id
    ? sessions.find((s) => s.id === rule.wa_session_id)
    : null;
  const sessionLabel = session
    ? (session.name || session.push_name || session.phone || rule.wa_session_id)
    : t("wa.automation.allNumbers");

  const replyPreview = (rule.reply_text ?? "").length > 80
    ? (expanded ? rule.reply_text : (rule.reply_text ?? "").slice(0, 80) + "...")
    : rule.reply_text;

  return (
    <Card className={cn("transition-opacity", !rule.is_active && "opacity-60")}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button onClick={onToggle} className="shrink-0" aria-label={rule.is_active ? t("wa.automation.deactivate") : t("wa.automation.activate")}>
              {rule.is_active ? (
                <ToggleRight className="size-5 text-[var(--color-success)]" />
              ) : (
                <ToggleLeft className="size-5 text-[var(--color-fg-muted)]" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm text-[var(--color-fg)] truncate">{rule.name}</p>
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]">
                  {matchLabel}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Edit2 size={14} />
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 size={14} className="text-[var(--color-error)]" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[var(--color-fg-muted)]">{t("wa.automation.keywords")}:</span>
          {(rule.keywords ?? []).map((kw) => (
            <span key={kw} className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-fg)]">{kw}</span>
          ))}
        </div>

        {(rule.reply_text ?? "").length > 0 && (
          <div className="rounded-lg bg-[var(--color-surface-2)] p-2.5">
            <p className="text-xs text-[var(--color-fg-muted)] mb-1">{t("wa.automation.replyText")}:</p>
            <p className="text-sm text-[var(--color-fg)] whitespace-pre-wrap break-words">{replyPreview}</p>
            {(rule.reply_text ?? "").length > 80 && (
              <button onClick={() => setExpanded(!expanded)} className="mt-1 text-xs text-[var(--color-primary-soft)] hover:underline">
                {expanded ? t("wa.automation.showLess") : t("wa.automation.showMore")}
              </button>
            )}
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-[var(--color-fg-muted)]">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {t("wa.automation.delayValue", { sec: (rule as any).reply_delay_sec ?? 0 })}
          </span>
          <span className="flex items-center gap-1">
            <Smartphone size={12} />
            <span className="truncate max-w-[120px]">{sessionLabel}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Rule Dialog (Create / Edit)
// ═══════════════════════════════════════════════════════════

function RuleDialog({
  rule,
  open,
  onClose,
  workspaceId,
  sessions,
  onSave,
}: {
  rule: WaKeywordRule | null;
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  sessions: { id: string; name?: string | null; phone?: string | null; push_name?: string | null }[];
  onSave: (data: Partial<WaKeywordRule> & { workspaceId: string }) => void;
}) {
  const { t } = useTranslation();
  const isEdit = rule !== null;

  const [name, setName] = useState(rule?.name ?? "");
  const [matchType, setMatchType] = useState(() => {
    const mt = rule?.match_type as string | undefined;
    return mt === "equals" || mt === "contains" ? mt : "contains";
  });
  const [keywords, setKeywords] = useState<string[]>(rule?.keywords ?? []);
  const [keywordInput, setKeywordInput] = useState("");
  const [replyText, setReplyText] = useState(rule?.reply_text ?? "");
  const [delay, setDelay] = useState((rule as any)?.reply_delay_sec ?? 0);
  const [sessionId, setSessionId] = useState<string>(rule?.wa_session_id ?? "");
  const [caseSensitive, setCaseSensitive] = useState(rule?.case_sensitive ?? false);
  const [priority, setPriority] = useState(rule?.priority ?? 100);

  const addKeyword = () => {
    const val = keywordInput.trim();
    if (!val || keywords.includes(val)) return;
    setKeywords([...keywords, val]);
    setKeywordInput("");
  };

  const removeKeyword = (kw: string) => {
    setKeywords(keywords.filter((k) => k !== kw));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); addKeyword(); }
  };

  const handleSave = () => {
    if (!name.trim()) { toast({ type: "error", title: t("wa.automation.nameRequired") }); return; }
    if (keywords.length === 0) { toast({ type: "error", title: t("wa.automation.emptyKeywords") }); return; }
    if (!replyText.trim()) { toast({ type: "error", title: t("wa.automation.emptyReply") }); return; }

    onSave({
      workspaceId,
      id: rule?.id,
      name: name.trim(),
      match_type: matchType as any,
      keywords,
      reply_text: replyText.trim(),
      reply_delay_sec: Math.max(0, Math.min(60, delay)),
      wa_session_id: sessionId || null,
      case_sensitive: caseSensitive,
      priority,
      is_active: rule?.is_active ?? true,
    } as any);
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{isEdit ? t("wa.automation.editTitle") : t("wa.automation.createTitle")}</DialogTitle>
        <DialogClose onClose={onClose} />
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4 py-2">
          <div>
            <Label>{t("wa.automation.ruleName")}</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("wa.automation.ruleNamePlaceholder")}
            />
          </div>

          <div>
            <Label>{t("wa.automation.matchType")}</Label>
            <Select
              value={matchType}
              onValueChange={setMatchType}
              options={[
                { value: "contains", label: t("wa.automation.matchContains") },
                { value: "equals", label: t("wa.automation.matchEquals") },
              ]}
            />
            <p className="text-xs text-[var(--color-fg-subtle)] mt-1">
              {matchType === "equals" ? t("wa.automation.matchEqualsDesc") : t("wa.automation.matchContainsDesc")}
            </p>
          </div>

          <div>
            <Label>{t("wa.automation.keywords")}</Label>
            <div className="flex gap-2">
              <Input
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("wa.automation.keywordPlaceholder")}
                className="flex-1"
              />
              <Button variant="outline" onClick={addKeyword} disabled={!keywordInput.trim()}>
                {t("wa.automation.addKeyword")}
              </Button>
            </div>
            {keywords.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {keywords.map((kw) => (
                  <span key={kw} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-[var(--color-surface-2)] text-[var(--color-fg)]">
                    {kw}
                    <button onClick={() => removeKeyword(kw)} className="text-[var(--color-fg-muted)] hover:text-[var(--color-error)]">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-[var(--color-fg-subtle)] mt-1">{t("wa.automation.keywordsHint")}</p>
          </div>

          <div>
            <Label>{t("wa.automation.replyText")}</Label>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={t("wa.automation.replyTextPlaceholder")}
              className="w-full min-h-[100px] mt-1 p-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-sm text-[var(--color-fg)] resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t("wa.automation.replyDelay")}</Label>
              <Input
                type="number"
                value={delay}
                onChange={(e) => setDelay(Math.max(0, Math.min(60, parseInt(e.target.value) || 0)))}
                min={0}
                max={60}
              />
              <p className="text-xs text-[var(--color-fg-subtle)] mt-1">
                {delay === 0 ? t("wa.automation.instantReply") : t("wa.automation.delayValue", { sec: delay })}
              </p>
            </div>
            <div>
              <Label>{t("wa.automation.priority")}</Label>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 100)}
                min={1}
                max={999}
              />
              <p className="text-xs text-[var(--color-fg-subtle)] mt-1">{t("wa.automation.priorityHint")}</p>
            </div>
          </div>

          <div>
            <Label>{t("wa.automation.applyTo")}</Label>
            <Select
              value={sessionId}
              onValueChange={setSessionId}
              options={[
                { value: "", label: t("wa.automation.allNumbers") },
                ...(sessions ?? []).map((s) => ({
                  value: s.id,
                  label: s.name || s.push_name || s.phone || s.id.slice(0, 8),
                })),
              ]}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="case-sensitive"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <Label htmlFor="case-sensitive">{t("wa.automation.caseSensitive")}</Label>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={handleSave}>
            <Plus size={16} />
            {isEdit ? t("common.save") : t("common.create")}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}
