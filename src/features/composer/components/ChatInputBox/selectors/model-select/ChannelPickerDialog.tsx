import { useTranslation } from "react-i18next";
import CheckIcon from "lucide-react/dist/esm/icons/check";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PickerModelGroup } from "./pickerGroups";

/**
 * ChannelPickerDialog —— 引擎子菜单底栏「切换渠道」弹窗。
 *
 * 从 ModelSelect.tsx 平移（openspec change refactor-composer-selector-layer
 * Phase 3）：JSX 与 class/data-* 契约零改动，仅收拢为 props 注入的独立子组件。
 */
export function ChannelPickerDialog({
  group,
  onClose,
  onSelectProfile,
}: {
  group: PickerModelGroup | null;
  onClose: () => void;
  onSelectProfile: (profileId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={group != null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="flex max-h-[min(80vh,32rem)] w-[min(100vw-2rem,24rem)] flex-col gap-3 sm:max-w-md"
        data-channel-picker-dialog={group?.providerId ?? undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {t("models.switchChannel", { defaultValue: "切换渠道" })}
          </DialogTitle>
          <DialogDescription>
            {t("models.selectChannelForEngine", {
              name: group?.providerLabel ?? "",
              defaultValue: `选择 ${group?.providerLabel ?? ""} 的配置渠道`,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {group?.profiles.map((profile) => {
            const isActive = profile.id === group.targetProfileId;
            return (
              <button
                key={profile.id}
                type="button"
                data-provider-profile-id={profile.id}
                data-channel-option={group.providerId}
                data-selected={isActive ? "true" : undefined}
                className="flex w-full items-center gap-2 rounded-md border border-transparent px-3 py-2.5 text-left text-sm hover:bg-accent hover:text-accent-foreground data-[selected=true]:border-border data-[selected=true]:bg-muted/60"
                onClick={() => {
                  onSelectProfile(profile.id);
                }}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {profile.label}
                </span>
                {isActive && (
                  <CheckIcon className="size-4 shrink-0" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
