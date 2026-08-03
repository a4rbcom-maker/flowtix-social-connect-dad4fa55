import { Link } from "react-router-dom";
import { Plug } from "lucide-react";
import { Select } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/state";
import { Button } from "@/components/ui/button";
import { useActiveSessionsForSelect } from "@/hooks/useFbSessions";
import { useTranslation } from "react-i18next";

interface Props {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

export function FbSessionSelector({ value, onChange, label }: Props) {
  const { t } = useTranslation();
  const activeSessions = useActiveSessionsForSelect();

  if (!activeSessions.data || activeSessions.data.length === 0) {
    return (
      <EmptyState
        title={t("sessions.empty.title")}
        description={t("sessions.empty.description")}
        icon={Plug}
        action={
          <Button asChild>
            <Link to="/dashboard/facebook/sessions">
              <Plug className="size-4" />
              {t("sessions.add.title")}
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {label && <label className="text-sm font-medium text-[var(--color-fg)]">{label}</label>}
      <Select
        value={value}
        onValueChange={onChange}
        options={[
          { value: "", label: t("extract.chooseSession") },
          ...activeSessions.data,
        ]}
      />
    </div>
  );
}
