import claudeCodeCliIcon from "@lobehub/icons-static-svg/icons/claudecode-color.svg";
import claudeCodeCliMonoIcon from "@lobehub/icons-static-svg/icons/claudecode.svg";
import codeBuddyCliMonoIcon from "@lobehub/icons-static-svg/icons/codebuddy.svg";
import codexCliIcon from "@lobehub/icons-static-svg/icons/codex-color.svg";
import codexCliMonoIcon from "@lobehub/icons-static-svg/icons/codex.svg";
import copilotCliMonoIcon from "@lobehub/icons-static-svg/icons/copilot.svg";
import cursorCliIcon from "@lobehub/icons-static-svg/icons/cursor.svg";
import deepseekCliIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import deepseekCliMonoIcon from "@lobehub/icons-static-svg/icons/deepseek.svg";
import geminiCliMonoIcon from "@lobehub/icons-static-svg/icons/geminicli.svg";
import glmCliMonoIcon from "@lobehub/icons-static-svg/icons/chatglm.svg";
import grokCliMonoIcon from "@lobehub/icons-static-svg/icons/grok.svg";
import huaweiMonoIcon from "@lobehub/icons-static-svg/icons/huawei.svg";
import kimiCliIcon from "@lobehub/icons-static-svg/icons/kimi.svg";
import kimiCliMonoIcon from "@lobehub/icons-static-svg/icons/kimi.svg";
import openCodeCliIcon from "@lobehub/icons-static-svg/icons/opencode.svg";
import openCodeCliMonoIcon from "@lobehub/icons-static-svg/icons/opencode.svg";
import piCliIcon from "@lobehub/icons-static-svg/icons/pi.svg";
import piCliMonoIcon from "@lobehub/icons-static-svg/icons/pi.svg";
import qoderCliMonoIcon from "@lobehub/icons-static-svg/icons/qoder.svg";
import qwenCliMonoIcon from "@lobehub/icons-static-svg/icons/qwen.svg";
import traeCliMonoIcon from "@lobehub/icons-static-svg/icons/trae.svg";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Ellipsis from "lucide-react/dist/esm/icons/ellipsis";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { VendorTab } from "../types";

type UnsupportedCliEngineId =
  | "qwen"
  | "codebuddy"
  | "copilot"
  | "cursor"
  | "gemini"
  | "glm"
  | "trae"
  | "deveco"
  | "iflow"
  | "ruixing"
  | "feishu"
  | "kiro";

export type CliEngineId = VendorTab | UnsupportedCliEngineId;

export type CliEngineNavItem =
  | { key: VendorTab; label: string; hasConfig: boolean; supported: true; docsUrl: string }
  | { key: UnsupportedCliEngineId; label: string; supported: false; docsUrl: string };

export type SupportedCliEngineNavItem = Extract<
  CliEngineNavItem,
  { supported: true }
>;
export type UnsupportedCliEngineNavItem = Extract<
  CliEngineNavItem,
  { supported: false }
>;

export type CliEngineNavGroupKey = "enabled" | "disabled" | "upcoming";

export type CliEngineNavGroups = {
  enabled: SupportedCliEngineNavItem[];
  disabled: SupportedCliEngineNavItem[];
  upcoming: UnsupportedCliEngineNavItem[];
};

/**
 * 把平铺 nav items 按「用户意愿 × supported」分三组：
 * 已启用（supported 且未停用）/ 未启用（supported 且已停用）/ 暂未开放（unsupported）。
 * 组内保持注册表固定顺序，不做智能排序。
 */
export function groupCliEngineNavItems(
  items: CliEngineNavItem[],
  disabledCliEngineIds: readonly string[],
): CliEngineNavGroups {
  const disabledIds = new Set(disabledCliEngineIds);
  const enabled: SupportedCliEngineNavItem[] = [];
  const disabled: SupportedCliEngineNavItem[] = [];
  const upcoming: UnsupportedCliEngineNavItem[] = [];
  for (const item of items) {
    if (!item.supported) {
      upcoming.push(item);
    } else if (disabledIds.has(item.key)) {
      disabled.push(item);
    } else {
      enabled.push(item);
    }
  }
  return { enabled, disabled, upcoming };
}

export const CLI_DOCS_HREF_BY_ID: Record<CliEngineId, string> = {
  claude: "https://code.claude.com/docs/en/cli-reference",
  codex: "https://learn.chatgpt.com/docs/codex/cli",
  gemini: "https://developers.google.com/gemini-code-assist/docs/gemini-cli",
  grok: "https://x.ai/cli",
  opencode: "https://opencode.ai/docs/",
  dsh: "https://github.com/deepseek-ai/dsh",
  glm: "https://docs.z.ai/devpack/quick-start",
  trae: "https://docs.trae.ai/",
  cursor: "https://cursor.com/docs/cli/overview",
  kimi: "https://www.kimi.com/code/docs/en/",
  ruixing: "https://open.lkcoffee.com/docs",
  deveco: "https://developer.huawei.com/consumer/en/doc/harmonyos-guides/ide-commandline-get",
  pi: "https://pi.dev/docs/latest/usage",
  omp: "https://omp.sh",
  iflow: "https://github.com/iflow-ai/iflow-cli",
  qoder: "https://docs.qoder.com/en/cli/using-cli",
  qwen: "https://qwenlm.github.io/qwen-code-docs/en/users/overview/",
  codebuddy: "https://www.codebuddy.ai/docs/cli/quickstart",
  copilot: "https://docs.github.com/en/copilot/how-tos/copilot-cli",
  feishu: "https://open.feishu.cn/document/home/index",
  kiro: "https://kiro.dev/docs/cli/",
};

const CLI_ICON_BY_ID: Record<CliEngineId, string | null> = {
  claude: claudeCodeCliIcon,
  codex: codexCliIcon,
  gemini: geminiCliMonoIcon,
  grok: grokCliMonoIcon,
  opencode: openCodeCliIcon,
  dsh: deepseekCliIcon,
  glm: glmCliMonoIcon,
  trae: traeCliMonoIcon,
  cursor: cursorCliIcon,
  kimi: kimiCliIcon,
  ruixing: null,
  deveco: huaweiMonoIcon,
  pi: piCliIcon,
  omp: piCliIcon,
  iflow: null,
  qoder: qoderCliMonoIcon,
  qwen: qwenCliMonoIcon,
  codebuddy: codeBuddyCliMonoIcon,
  copilot: copilotCliMonoIcon,
  feishu: null,
  kiro: null,
};

const CLI_MONO_ICON_BY_ID: Record<CliEngineId, string | null> = {
  claude: claudeCodeCliMonoIcon,
  codex: codexCliMonoIcon,
  gemini: geminiCliMonoIcon,
  grok: grokCliMonoIcon,
  opencode: openCodeCliMonoIcon,
  dsh: deepseekCliMonoIcon,
  glm: glmCliMonoIcon,
  trae: traeCliMonoIcon,
  cursor: cursorCliIcon,
  kimi: kimiCliMonoIcon,
  ruixing: null,
  deveco: huaweiMonoIcon,
  pi: piCliMonoIcon,
  omp: piCliMonoIcon,
  iflow: null,
  qoder: qoderCliMonoIcon,
  qwen: qwenCliMonoIcon,
  codebuddy: codeBuddyCliMonoIcon,
  copilot: copilotCliMonoIcon,
  feishu: null,
  kiro: null,
};

const COLOR_CLI_ICON_IDS = new Set<CliEngineId>(["claude", "codex", "dsh"]);

export function buildCliEngineNavItems(options: {
  claudeHasConfig: boolean;
  codexHasConfig: boolean;
  kimiHasConfig: boolean;
  grokHasConfig: boolean;
  openCodeHasConfig: boolean;
  piHasConfig: boolean;
  ompHasConfig: boolean;
  dshHasConfig: boolean;
  qoderHasConfig: boolean;
}): CliEngineNavItem[] {
  return [
    { key: "claude", label: "Claude Code CLI", hasConfig: options.claudeHasConfig, supported: true, docsUrl: CLI_DOCS_HREF_BY_ID.claude },
    { key: "codex", label: "Codex CLI", hasConfig: options.codexHasConfig, supported: true, docsUrl: CLI_DOCS_HREF_BY_ID.codex },
    { key: "kimi", label: "Kimi CLI", hasConfig: options.kimiHasConfig, supported: true, docsUrl: CLI_DOCS_HREF_BY_ID.kimi },
    { key: "gemini", label: "Gemini CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.gemini },
    { key: "grok", label: "Grok CLI", hasConfig: options.grokHasConfig, supported: true, docsUrl: CLI_DOCS_HREF_BY_ID.grok },
    { key: "opencode", label: "OpenCode CLI", hasConfig: options.openCodeHasConfig, supported: true, docsUrl: CLI_DOCS_HREF_BY_ID.opencode },
    { key: "pi", label: "PI CLI", hasConfig: options.piHasConfig, supported: true, docsUrl: CLI_DOCS_HREF_BY_ID.pi },
    { key: "omp", label: "OMP CLI", hasConfig: options.ompHasConfig, supported: true, docsUrl: CLI_DOCS_HREF_BY_ID.omp },
    { key: "dsh", label: "DeepSeek Harness", hasConfig: options.dshHasConfig, supported: true, docsUrl: CLI_DOCS_HREF_BY_ID.dsh },
    { key: "qoder", label: "Qoder CLI", hasConfig: options.qoderHasConfig, supported: true, docsUrl: CLI_DOCS_HREF_BY_ID.qoder },
    { key: "glm", label: "GLM CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.glm },
    { key: "trae", label: "Trae CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.trae },
    { key: "cursor", label: "Cursor CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.cursor },
    { key: "ruixing", label: "瑞幸 CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.ruixing },
    { key: "deveco", label: "DevEco CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.deveco },
    { key: "iflow", label: "iFlow CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.iflow },
    { key: "qwen", label: "Qwen CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.qwen },
    { key: "codebuddy", label: "CodeBuddy CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.codebuddy },
    { key: "copilot", label: "Copilot CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.copilot },
    { key: "feishu", label: "飞书 CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.feishu },
    { key: "kiro", label: "Kiro CLI", supported: false, docsUrl: CLI_DOCS_HREF_BY_ID.kiro },
  ];
}

export function CliIcon({
  id,
  label,
  monochrome = false,
}: {
  id: CliEngineId;
  label: string;
  monochrome?: boolean;
}) {
  const useMonochrome = monochrome || !COLOR_CLI_ICON_IDS.has(id);
  const icon = useMonochrome ? CLI_MONO_ICON_BY_ID[id] : CLI_ICON_BY_ID[id];
  return icon ? (
    <img
      src={icon}
      alt=""
      className={cn("vendor-cli-logo-img", useMonochrome && "vendor-cli-logo-img-mono")}
      aria-hidden="true"
    />
  ) : (
    <span
      className={cn(
        "vendor-cli-logo",
        `vendor-cli-logo-${id}`,
        useMonochrome && "vendor-cli-logo-mono",
      )}
      aria-hidden="true"
    >
      {label.charAt(0)}
    </span>
  );
}

type CliEngineNavRowProps = {
  item: CliEngineNavItem;
  active: boolean;
  disabledIds: ReadonlySet<string>;
  moreLabel: string;
  disableLabel: string;
  enableLabel: string;
  onSelectCli: (id: CliEngineId) => void;
  onToggleCliEnabled: (id: VendorTab, enabled: boolean) => void;
};

/**
 * 单行 CLI nav row：视觉容器内放「选中主按钮 + 兄弟 hover「...」菜单」，
 * 避免 button 嵌套 button 的非法结构;菜单只控制前台可见性,默认收起不打扰。
 */
export function CliEngineNavRow({
  item,
  active,
  disabledIds,
  moreLabel,
  disableLabel,
  enableLabel,
  onSelectCli,
  onToggleCliEnabled,
}: CliEngineNavRowProps) {
  return (
    <div
      className={cn(
        "vendor-engine-tab flex w-full items-center text-left text-foreground transition-colors",
        active && "vendor-engine-tab-active",
        !item.supported && "vendor-engine-tab-upcoming",
      )}
    >
      <button
        type="button"
        className="vendor-engine-tab-main"
        aria-current={active ? "true" : undefined}
        onClick={() => onSelectCli(item.key)}
      >
        <span className="vendor-engine-icon flex shrink-0 items-center justify-center border bg-background">
          <CliIcon
            id={item.key}
            label={item.label}
            monochrome={!item.supported}
          />
        </span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </button>
      {item.supported ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="vendor-engine-more"
              aria-label={moreLabel}
            >
              <Ellipsis size={14} aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom">
            <DropdownMenuItem
              onSelect={() =>
                onToggleCliEnabled(item.key, disabledIds.has(item.key))
              }
            >
              {disabledIds.has(item.key) ? enableLabel : disableLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

type CliEngineNavGroupSectionProps = {
  label: string;
  items: CliEngineNavItem[];
  collapsed: boolean;
  activeCli: CliEngineId;
  disabledIds: ReadonlySet<string>;
  moreLabel: string;
  disableLabel: string;
  enableLabel: string;
  emptyHint?: string;
  onToggleGroup: () => void;
  onSelectCli: (id: CliEngineId) => void;
  onToggleCliEnabled: (id: VendorTab, enabled: boolean) => void;
};

export function CliEngineNavGroupSection({
  label,
  items,
  collapsed,
  activeCli,
  disabledIds,
  moreLabel,
  disableLabel,
  enableLabel,
  emptyHint,
  onToggleGroup,
  onSelectCli,
  onToggleCliEnabled,
}: CliEngineNavGroupSectionProps) {
  return (
    <div
      className={cn(
        "vendor-engine-group",
        collapsed && "vendor-engine-group-collapsed",
      )}
    >
      <button
        type="button"
        className="vendor-engine-group-header"
        aria-expanded={!collapsed}
        onClick={onToggleGroup}
      >
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={cn(
            "vendor-engine-group-chevron",
            collapsed && "vendor-engine-group-chevron-collapsed",
          )}
        />
        <span>{label}</span>
      </button>
      <div className="vendor-engine-group-items">
        {items.length === 0 && emptyHint ? (
          <div className="vendor-engine-group-empty">{emptyHint}</div>
        ) : (
          items.map((item) => (
            <CliEngineNavRow
              key={item.key}
              item={item}
              active={activeCli === item.key}
              disabledIds={disabledIds}
              moreLabel={moreLabel}
              disableLabel={disableLabel}
              enableLabel={enableLabel}
              onSelectCli={onSelectCli}
              onToggleCliEnabled={onToggleCliEnabled}
            />
          ))
        )}
      </div>
    </div>
  );
}
