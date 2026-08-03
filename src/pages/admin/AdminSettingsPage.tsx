import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Settings, ToggleLeft, ToggleRight, Plus, Search, Edit2, Trash2,
  ChevronDown, ChevronRight, Save, X, Info, Sparkles, Key, UserPlus, ShieldAlert,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Select } from "@/components/ui/dropdown";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { LoadingState, EmptyState } from "@/components/ui/state";
import {
  useAdminSettings, useUpsertSetting, useDeleteSetting,
  useAdminFlags, useToggleFlag, useCreateFlag, useUpdateFlag, useDeleteFlag,
} from "@/hooks/useAdmin";
import type { AdminSettingItem, AdminSettingInput, AdminFeatureFlag, AdminFeatureFlagInput, AdminFeatureFlagUpdateInput } from "@/types/admin.types";
import { FLAG_CATEGORIES, SETTING_CATEGORIES } from "@/types/admin.types";
import type { FlagCategory } from "@/types/admin.types";

export function AdminSettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<"settings" | "flags">("settings");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.settings.title")}
        description={t("admin.settings.description")}
        icon={Settings}
      />

      <div className="flex gap-2">
        <Button
          variant={activeTab === "settings" ? "primary" : "ghost"}
          onClick={() => setActiveTab("settings")}
        >
          <Settings size={16} />
          {t("admin.settings.systemSettings")}
        </Button>
        <Button
          variant={activeTab === "flags" ? "primary" : "ghost"}
          onClick={() => setActiveTab("flags")}
        >
          <ToggleLeft size={16} />
          {t("admin.settings.featureFlags")}
        </Button>
      </div>

      {activeTab === "settings" && (
        <>
          <RegistrationToggle />
          <SettingsPanel />
        </>
      )}
      {activeTab === "flags" && <FeatureFlagsPanel />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Settings Panel
// ═══════════════════════════════════════════════════════════

function SettingsPanel() {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [editSetting, setEditSetting] = useState<AdminSettingItem | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: settings, isLoading } = useAdminSettings();
  const deleteMutation = useDeleteSetting();

  const grouped = useMemo(() => {
    if (!settings) return {};
    const groups: Record<string, AdminSettingItem[]> = {};
    for (const s of settings) {
      const parts = s.key.split(".");
      const cat = parts.length > 1 ? parts[0] : "general";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(s);
    }
    return groups;
  }, [settings]);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return grouped;
    const result: Record<string, AdminSettingItem[]> = {};
    for (const [cat, items] of Object.entries(grouped)) {
      const filtered = items.filter(
        (s) =>
          s.key.toLowerCase().includes(search.toLowerCase()) ||
          (s.description ?? "").toLowerCase().includes(search.toLowerCase()),
      );
      if (filtered.length > 0) result[cat] = filtered;
    }
    return result;
  }, [grouped, search]);

  const getCategoryLabel = (cat: string) => {
    const found = SETTING_CATEGORIES.find((c) => c.value === cat);
    return found ? found.label[i18n.language === "ar" ? "ar" : "en"] : cat;
  };

  const handleDelete = (key: string) => {
    if (!confirm(t("admin.settings.confirmDelete"))) return;
    deleteMutation.mutate(key, {
      onSuccess: () => toast({ type: "success", title: t("admin.settings.deleted") }),
      onError: () => toast({ type: "error", title: t("common.error") }),
    });
  };

  const groupKeys = Object.keys(filteredGroups);
  const expanded = expandedGroup ?? (groupKeys[0] || null);

  if (isLoading) return <LoadingState />;
  if (!settings?.length) return <EmptyState title={t("admin.settings.noSettings")} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-muted)]" />
          <Input
            placeholder={t("admin.settings.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-10"
          />
        </div>
        <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
          <Plus size={16} />
          {t("admin.settings.addSetting")}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t("admin.settings.totalSettings")} value={settings.length} icon={Settings} />
        <StatCard
          label={t("admin.settings.publicSettings")}
          value={settings.filter((s) => s.is_public).length}
          icon={Info}
        />
        <StatCard label={t("admin.settings.categories")} value={groupKeys.length} icon={Key} />
      </div>

      <div className="space-y-3">
        {groupKeys.map((cat) => (
          <Card key={cat}>
            <CardHeader
              className="cursor-pointer select-none flex items-center justify-between"
              onClick={() => setExpandedGroup(expanded === cat ? null : cat)}
            >
              <CardTitle className="text-base">{getCategoryLabel(cat)}</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-fg-subtle)]">{filteredGroups[cat].length}</span>
                {expanded === cat ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>
            </CardHeader>
            {expanded === cat && (
              <CardContent className="space-y-3">
                {filteredGroups[cat].map((setting) => (
                  <SettingRow
                    key={setting.key}
                    setting={setting}
                    onEdit={() => setEditSetting(setting)}
                    onDelete={() => handleDelete(setting.key)}
                  />
                ))}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {editSetting && (
        <EditSettingDialog
          setting={editSetting}
          open={!!editSetting}
          onClose={() => setEditSetting(null)}
        />
      )}
      {isCreateOpen && (
        <EditSettingDialog
          open={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          isCreate
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Setting Row
// ═══════════════════════════════════════════════════════════

function SettingRow({
  setting,
  onEdit,
  onDelete,
}: {
  setting: AdminSettingItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const isJson = typeof setting.value === "object" && setting.value !== null;

  return (
    <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <code className="text-sm font-mono text-[var(--color-fg-muted)]">{setting.key}</code>
          {setting.is_public && <span className="text-xs text-[var(--color-success)] font-medium">{t("admin.settings.public")}</span>}
        </div>
        {setting.description && (
          <p className="text-sm text-[var(--color-fg-muted)]">{setting.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <code className="text-xs max-w-[200px] truncate px-2 py-1 rounded bg-[var(--color-bg)] text-[var(--color-fg-subtle)]">
          {isJson ? JSON.stringify(setting.value) : String(setting.value)}
        </code>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Edit2 size={14} />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 size={14} className="text-[var(--color-error)]" />
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Edit / Create Setting Dialog
// ═══════════════════════════════════════════════════════════

function EditSettingDialog({
  setting,
  open,
  onClose,
  isCreate = false,
}: {
  setting?: AdminSettingItem | null;
  open: boolean;
  onClose: () => void;
  isCreate?: boolean;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState(setting?.key ?? "");
  const [value, setValue] = useState(
    setting?.value ? JSON.stringify(setting.value, null, 2) : "",
  );
  const [description, setDescription] = useState(setting?.description ?? "");
  const [isPublic, setIsPublic] = useState(setting?.is_public ?? false);
  const [valueError, setValueError] = useState<string | null>(null);

  const upsertMutation = useUpsertSetting();

  const handleSave = () => {
    if (!key.trim()) {
      toast({ type: "error", title: t("admin.settings.keyRequired") });
      return;
    }
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(value || "null");
    } catch {
      setValueError(t("admin.settings.invalidJson"));
      return;
    }
    const input: AdminSettingInput = {
      key: key.trim(),
      value: parsedValue,
      description: description.trim() || null,
      is_public: isPublic,
    };
    upsertMutation.mutate(input, {
      onSuccess: () => {
        toast({ type: "success", title: isCreate ? t("admin.settings.created") : t("admin.settings.updated") });
        onClose();
      },
      onError: (e: any) => {
        if (e.message === "setting_not_found") {
          toast({ type: "error", title: t("admin.settings.notFound") });
        } else {
          toast({ type: "error", title: t("common.error") });
        }
      },
    });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>
          {isCreate ? t("admin.settings.createTitle") : t("admin.settings.editTitle")}
        </DialogTitle>
        <DialogClose onClose={onClose} />
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4 py-2">
          <div>
            <Label>{t("admin.settings.keyLabel")}</Label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={!isCreate}
              placeholder="general.site_name"
            />
          </div>
          <div>
            <Label>{t("admin.settings.valueLabel")}</Label>
            <textarea
              value={value}
              onChange={(e) => { setValue(e.target.value); setValueError(null); }}
              className="w-full min-h-[120px] mt-1 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
              placeholder='{"key": "value"}'
            />
            {valueError && <p className="text-[var(--color-error)] text-sm mt-1">{valueError}</p>}
          </div>
          <div>
            <Label>{t("admin.settings.descriptionLabel")}</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("admin.settings.descriptionPlaceholder")}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="setting-public"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <Label htmlFor="setting-public">{t("admin.settings.publicLabel")}</Label>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            <X size={16} />
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={handleSave} loading={upsertMutation.isPending}>
            <Save size={16} />
            {t("common.save") ?? "Save"}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════
// Feature Flags Panel
// ═══════════════════════════════════════════════════════════

function FeatureFlagsPanel() {
  const { t, i18n } = useTranslation();
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const [editFlag, setEditFlag] = useState<AdminFeatureFlag | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: flags, isLoading } = useAdminFlags(category || undefined);
  const toggleMutation = useToggleFlag();
  const deleteMutation = useDeleteFlag();

  const locale: "en" | "ar" = i18n.language === "ar" ? "ar" : "en";

  const filteredFlags = useMemo(() => {
    if (!flags) return [];
    if (!search.trim()) return flags;
    return flags.filter(
      (f) =>
        f.key.toLowerCase().includes(search.toLowerCase()) ||
        (f.name[locale] ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (f.description[locale] ?? "").toLowerCase().includes(search.toLowerCase()),
    );
  }, [flags, search, locale]);

  const groupedFlags = useMemo(() => {
    const groups: Record<string, AdminFeatureFlag[]> = {};
    for (const f of filteredFlags) {
      if (!groups[f.category]) groups[f.category] = [];
      groups[f.category].push(f);
    }
    return groups;
  }, [filteredFlags]);

  const getCategoryLabel = (cat: string) => {
    const found = FLAG_CATEGORIES.find((c) => c.value === cat);
    return found ? found.label[locale] : cat;
  };

  const handleToggle = (flag: AdminFeatureFlag) => {
    toggleMutation.mutate(
      { flagId: flag.id, enabled: !flag.is_enabled },
      {
        onSuccess: () => {
          toast({
            type: "success",
            title: flag.is_enabled
              ? t("admin.settings.flagDisabled")
              : t("admin.settings.flagEnabled"),
          });
        },
        onError: () => toast({ type: "error", title: t("common.error") }),
      },
    );
  };

  const handleDelete = (flag: AdminFeatureFlag) => {
    if (!confirm(t("admin.settings.confirmDeleteFlag"))) return;
    deleteMutation.mutate(flag.id, {
      onSuccess: () => toast({ type: "success", title: t("admin.settings.deleted") }),
      onError: () => toast({ type: "error", title: t("common.error") }),
    });
  };

  if (isLoading) return <LoadingState />;
  if (!flags?.length) return <EmptyState title={t("admin.settings.noFlags")} />;

  const enabledCount = flags.filter((f) => f.is_enabled).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-muted)]" />
          <Input
            placeholder={t("admin.settings.searchFlags")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-10"
          />
        </div>
        <Select
          value={category}
          onValueChange={(val) => setCategory(val)}
          options={[
            { value: "", label: t("admin.settings.allCategories") },
            ...FLAG_CATEGORIES.map((c) => ({
              value: c.value,
              label: c.label[locale],
            })),
          ]}
        />
        <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
          <Plus size={16} />
          {t("admin.settings.addFlag")}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label={t("admin.settings.totalFlags")} value={flags.length} icon={Sparkles} />
        <StatCard
          label={t("admin.settings.enabledFlags")}
          value={enabledCount}
          icon={ToggleRight}
        />
        <StatCard
          label={t("admin.settings.disabledFlags")}
          value={flags.length - enabledCount}
          icon={ToggleLeft}
        />
      </div>

      <div className="space-y-4">
        {Object.entries(groupedFlags).map(([cat, catFlags]) => (
          <Card key={cat}>
            <CardHeader className="flex items-center gap-2">
              <CardTitle className="text-base">{getCategoryLabel(cat)}</CardTitle>
              <span className="text-xs text-[var(--color-fg-subtle)]">{catFlags.length}</span>
            </CardHeader>
            <CardContent className="space-y-2">
              {catFlags.map((flag) => (
                <div
                  key={flag.id}
                  className="flex items-center justify-between gap-4 p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <button
                      onClick={() => handleToggle(flag)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        flag.is_enabled
                          ? "gradient-brand"
                          : "bg-[var(--color-border-strong)]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 start-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                          flag.is_enabled ? "translate-x-5" : ""
                        }`}
                      />
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{flag.name[locale]}</span>
                        <code className="text-xs text-[var(--color-fg-muted)]">{flag.key}</code>
                        {flag.plan_key && (
                          <span className="text-xs text-[var(--color-warning)] font-medium">{flag.plan_key}</span>
                        )}
                      </div>
                      <p className="text-sm text-[var(--color-fg-muted)] truncate">
                        {flag.description[locale]}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => setEditFlag(flag)}>
                      <Edit2 size={14} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(flag)}>
                      <Trash2 size={14} className="text-[var(--color-error)]" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {editFlag && (
        <EditFlagDialog
          flag={editFlag}
          open={!!editFlag}
          onClose={() => setEditFlag(null)}
        />
      )}
      {isCreateOpen && (
        <CreateFlagDialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Edit Flag Dialog
// ═══════════════════════════════════════════════════════════

function EditFlagDialog({
  flag,
  open,
  onClose,
}: {
  flag: AdminFeatureFlag;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale: "en" | "ar" = i18n.language === "ar" ? "ar" : "en";

  const [nameEn, setNameEn] = useState(flag.name.en ?? "");
  const [nameAr, setNameAr] = useState(flag.name.ar ?? "");
  const [descEn, setDescEn] = useState(flag.description.en ?? "");
  const [descAr, setDescAr] = useState(flag.description.ar ?? "");
  const [cat, setCat] = useState(flag.category);
  const [planKey, setPlanKey] = useState(flag.plan_key ?? "");

  const updateMutation = useUpdateFlag();

  const handleSave = () => {
    const input: AdminFeatureFlagUpdateInput = {
      name: { en: nameEn, ar: nameAr },
      description: { en: descEn, ar: descAr },
      category: cat as FlagCategory,
      plan_key: planKey || null,
    };
    updateMutation.mutate(
      { flagId: flag.id, input },
      {
        onSuccess: () => {
          toast({ type: "success", title: t("admin.settings.updated") });
          onClose();
        },
        onError: () => toast({ type: "error", title: t("common.error") }),
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{t("admin.settings.editFlagTitle")}</DialogTitle>
        <DialogClose onClose={onClose} />
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("admin.settings.keyLabel")}</Label>
              <Input value={flag.key} disabled />
            </div>
            <div>
              <Label>{t("admin.settings.categoryLabel")}</Label>
              <Select
                value={cat}
                onValueChange={(val) => setCat(val as FlagCategory)}
                options={FLAG_CATEGORIES.map((c) => ({ value: c.value, label: c.label[locale] }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name (EN)</Label>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div>
              <Label>الاسم (AR)</Label>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Description (EN)</Label>
              <Input value={descEn} onChange={(e) => setDescEn(e.target.value)} />
            </div>
            <div>
              <Label>الوصف (AR)</Label>
              <Input value={descAr} onChange={(e) => setDescAr(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>{t("admin.settings.planKeyLabel")}</Label>
            <Input
              value={planKey}
              onChange={(e) => setPlanKey(e.target.value)}
              placeholder={t("admin.settings.planKeyPlaceholder")}
            />
            <p className="text-xs text-[var(--color-fg-subtle)] mt-1">
              {t("admin.settings.planKeyHint")}
            </p>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            <X size={16} />
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={handleSave} loading={updateMutation.isPending}>
            <Save size={16} />
            {t("common.save") ?? "Save"}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════
// Create Flag Dialog
// ═══════════════════════════════════════════════════════════

function CreateFlagDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale: "en" | "ar" = i18n.language === "ar" ? "ar" : "en";

  const [key, setKey] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [descEn, setDescEn] = useState("");
  const [descAr, setDescAr] = useState("");
  const [cat, setCat] = useState<FlagCategory>("general");
  const [isEnabled, setIsEnabled] = useState(false);
  const [planKey, setPlanKey] = useState("");

  const createMutation = useCreateFlag();

  const handleSave = () => {
    if (!key.trim()) {
      toast({ type: "error", title: t("admin.settings.keyRequired") });
      return;
    }
    if (!nameEn.trim() || !nameAr.trim()) {
      toast({ type: "error", title: t("admin.settings.nameRequired") });
      return;
    }
    const input: AdminFeatureFlagInput = {
      key: key.trim(),
      name: { en: nameEn, ar: nameAr },
      description: { en: descEn, ar: descAr },
      category: cat,
      is_enabled: isEnabled,
      plan_key: planKey || null,
    };
    createMutation.mutate(input, {
      onSuccess: () => {
        toast({ type: "success", title: t("admin.settings.flagCreated") });
        onClose();
      },
      onError: (e: any) => {
        if (e.message === "invalid_category") {
          toast({ type: "error", title: t("admin.settings.invalidCategory") });
        } else {
          toast({ type: "error", title: t("common.error") });
        }
      },
    });
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{t("admin.settings.createFlagTitle")}</DialogTitle>
        <DialogClose onClose={onClose} />
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4 py-2">
          <div>
            <Label>{t("admin.settings.keyLabel")}</Label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="my_new_feature"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name (EN)</Label>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div>
              <Label>الاسم (AR)</Label>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Description (EN)</Label>
              <Input value={descEn} onChange={(e) => setDescEn(e.target.value)} />
            </div>
            <div>
              <Label>الوصف (AR)</Label>
              <Input value={descAr} onChange={(e) => setDescAr(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("admin.settings.categoryLabel")}</Label>
              <Select
                value={cat}
                onValueChange={(val) => setCat(val as FlagCategory)}
                options={FLAG_CATEGORIES.map((c) => ({ value: c.value, label: c.label[locale] }))}
              />
            </div>
            <div>
              <Label>{t("admin.settings.planKeyLabel")}</Label>
              <Input
                value={planKey}
                onChange={(e) => setPlanKey(e.target.value)}
                placeholder={t("admin.settings.planKeyPlaceholder")}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="flag-enabled"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <Label htmlFor="flag-enabled">{t("admin.settings.enabledImmediately")}</Label>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            <X size={16} />
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={handleSave} loading={createMutation.isPending}>
            <Plus size={16} />
            {t("common.create") ?? "Create"}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}

function RegistrationToggle() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { (async () => {
    try {
      const { data } = await (supabase as any).rpc("admin_get_registration_status");
      setEnabled(data === true);
    } catch { setEnabled(true); }
  })(); }, []);

  async function toggle() {
    if (enabled === null) return;
    setLoading(true);
    try {
      await (supabase as any).rpc("admin_toggle_registration", { p_enabled: !enabled });
      setEnabled(!enabled);
      toast({ type: "success", title: enabled ? t("admin.settings.registrationDisabled") : t("admin.settings.registrationEnabled") });
    } catch (e: any) { toast({ type: "error", title: e.message }); }
    finally { setLoading(false); }
  }

  if (enabled === null) return null;

  return (
    <Card hover="lift">
      <CardContent className="flex items-center justify-between pt-6">
        <div className="flex items-start gap-4">
          <div className={`flex size-12 items-center justify-center rounded-xl shrink-0 ${enabled ? "bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-[var(--color-success)]" : "bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)] text-[var(--color-warning)]"}`}>
            {enabled ? <UserPlus className="size-6" /> : <ShieldAlert className="size-6" />}
          </div>
          <div>
            <h3 className="text-base font-bold text-[var(--color-fg)]">{t("admin.settings.registrationTitle")}</h3>
            <p className="text-sm text-[var(--color-fg-muted)]">{t(enabled ? "admin.settings.registrationEnabledDesc" : "admin.settings.registrationDisabledDesc")}</p>
            <div className="mt-2">
              <Badge variant={enabled ? "success" : "warning"}>
                {t(enabled ? "admin.settings.registrationsOpen" : "admin.settings.registrationsClosed")}
              </Badge>
            </div>
          </div>
        </div>
        <button onClick={toggle} disabled={loading}
          className={`relative w-14 h-7 rounded-full transition-colors shrink-0 ${enabled ? "bg-[var(--color-success)]" : "bg-[var(--color-surface-3)]"}`}>
          <span className={`absolute top-0.5 start-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${enabled ? "translate-x-7 rtl:-translate-x-7" : ""}`} />
        </button>
      </CardContent>
    </Card>
  );
}
