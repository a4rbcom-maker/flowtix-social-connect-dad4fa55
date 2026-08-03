import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Group, Send } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { MyGroupsTab } from "./MyGroupsTab";
import { PublishTab } from "./PublishTab";

type Tab = "my-groups" | "publish";

export function GroupsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("my-groups");
  const [selectedForPublish, setSelectedForPublish] = useState<{id: string; name: string}[]>([]);

  const handleGoToPublish = (ids: string[], names: string[]) => {
    setSelectedForPublish(ids.map((id, i) => ({ id, name: names[i] || id })));
    setTab("publish");
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("nav.fbGroups")} />

      <div className="flex flex-col gap-0">
        <div className="flex items-center gap-0 rounded-xl bg-[var(--color-surface-2)] p-1 w-fit">
          {(["my-groups", "publish"] as const).map((key) => {
            const Icon = key === "my-groups" ? Group : Send;
            const label = key === "my-groups" ? t("pages.groups.myGroups") : t("pages.groups.publish");
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                  active
                    ? "bg-[var(--color-bg)] text-[var(--color-fg)] shadow-sm"
                    : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-[400px]">
        {tab === "my-groups" && <MyGroupsTab onGoToPublish={handleGoToPublish} />}
        {tab === "publish" && <PublishTab preselected={selectedForPublish} />}
      </div>
    </div>
  );
}
