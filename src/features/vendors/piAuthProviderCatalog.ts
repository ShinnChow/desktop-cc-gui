/**
 * PI CLI 供应商认证 UI catalog。
 * OpenSpec: openspec/changes/add-pi-provider-auth
 *
 * - `id` 与后端 `pi_auth.rs` catalog / pi v0.84.1 envMap 对齐（auth.json 的 key）。
 * - 品牌图标走既有 npm 依赖 `@lobehub/icons-static-svg`（与 providerBrandIcon.ts 同模式）；
 *   无公开 logo 的 provider 返回 null，由调用方用 Globe 兜底，不用字母占位冒充品牌。
 * - featured=true 为默认展示的常用 16 项（设计稿 docs/prototypes/pi-provider-auth/），
 *   其余折叠进「显示全部」。
 */
import anthropicIcon from "@lobehub/icons-static-svg/icons/anthropic.svg";
import azureaiIcon from "@lobehub/icons-static-svg/icons/azureai-color.svg";
import basetenIcon from "@lobehub/icons-static-svg/icons/baseten.svg";
import bedrockIcon from "@lobehub/icons-static-svg/icons/bedrock-color.svg";
import cerebrasIcon from "@lobehub/icons-static-svg/icons/cerebras-color.svg";
import claudeIcon from "@lobehub/icons-static-svg/icons/claude-color.svg";
import cloudflareIcon from "@lobehub/icons-static-svg/icons/cloudflare-color.svg";
import copilotIcon from "@lobehub/icons-static-svg/icons/copilot-color.svg";
import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import fireworksIcon from "@lobehub/icons-static-svg/icons/fireworks-color.svg";
import geminiIcon from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import groqIcon from "@lobehub/icons-static-svg/icons/groq.svg";
import huggingfaceIcon from "@lobehub/icons-static-svg/icons/huggingface-color.svg";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import mistralIcon from "@lobehub/icons-static-svg/icons/mistral-color.svg";
import nvidiaIcon from "@lobehub/icons-static-svg/icons/nvidia-color.svg";
import openaiIcon from "@lobehub/icons-static-svg/icons/openai.svg";
import opencodeIcon from "@lobehub/icons-static-svg/icons/opencode.svg";
import openrouterIcon from "@lobehub/icons-static-svg/icons/openrouter-color.svg";
import qwenIcon from "@lobehub/icons-static-svg/icons/qwen-color.svg";
import togetherIcon from "@lobehub/icons-static-svg/icons/together-color.svg";
import vercelIcon from "@lobehub/icons-static-svg/icons/vercel.svg";
import xaiIcon from "@lobehub/icons-static-svg/icons/xai.svg";
import xiaomimimoIcon from "@lobehub/icons-static-svg/icons/xiaomimimo.svg";
import zhipuIcon from "@lobehub/icons-static-svg/icons/zhipu-color.svg";

export interface PiAuthUiProvider {
  /** auth.json 条目 key（后端 catalog id） */
  id: string;
  /** 品牌展示名（不翻译） */
  name: string;
  /** 品牌图标资源；null = 调用方 Globe 兜底 */
  iconSrc: string | null;
  /** 默认展示（true）或折叠进「显示全部」（false） */
  featured: boolean;
}

/** API Key 组：36 项（github-copilot 仅 OAuth，不在此组；moonshotai 双区随 pi 0.84.x env map 补录） */
export const PI_AUTH_APIKEY_PROVIDERS: readonly PiAuthUiProvider[] = [
  { id: "anthropic", name: "Anthropic", iconSrc: anthropicIcon, featured: true },
  { id: "openai", name: "OpenAI", iconSrc: openaiIcon, featured: true },
  { id: "google", name: "Google Gemini", iconSrc: geminiIcon, featured: true },
  { id: "deepseek", name: "DeepSeek", iconSrc: deepseekIcon, featured: true },
  { id: "xai", name: "xAI", iconSrc: xaiIcon, featured: true },
  { id: "openrouter", name: "OpenRouter", iconSrc: openrouterIcon, featured: true },
  { id: "groq", name: "Groq", iconSrc: groqIcon, featured: true },
  { id: "mistral", name: "Mistral", iconSrc: mistralIcon, featured: true },
  { id: "zai", name: "ZAI Coding Plan", iconSrc: zhipuIcon, featured: true },
  { id: "kimi-coding", name: "Kimi For Coding", iconSrc: kimiIcon, featured: true },
  { id: "moonshotai", name: "Moonshot AI", iconSrc: null, featured: false },
  { id: "moonshotai-cn", name: "Moonshot AI (China)", iconSrc: null, featured: false },
  { id: "qwen-token-plan", name: "Qwen Token Plan", iconSrc: qwenIcon, featured: true },
  { id: "minimax", name: "MiniMax", iconSrc: minimaxIcon, featured: true },
  { id: "together", name: "Together AI", iconSrc: togetherIcon, featured: true },
  { id: "fireworks", name: "Fireworks", iconSrc: fireworksIcon, featured: true },
  { id: "cerebras", name: "Cerebras", iconSrc: cerebrasIcon, featured: true },
  { id: "amazon-bedrock", name: "Amazon Bedrock", iconSrc: bedrockIcon, featured: true },
  { id: "ant-ling", name: "Ant Ling", iconSrc: null, featured: false },
  { id: "azure-openai-responses", name: "Azure OpenAI Responses", iconSrc: azureaiIcon, featured: false },
  { id: "nvidia", name: "NVIDIA NIM", iconSrc: nvidiaIcon, featured: false },
  { id: "cloudflare-ai-gateway", name: "Cloudflare AI Gateway", iconSrc: cloudflareIcon, featured: false },
  { id: "cloudflare-workers-ai", name: "Cloudflare Workers AI", iconSrc: cloudflareIcon, featured: false },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", iconSrc: vercelIcon, featured: false },
  { id: "zai-coding-cn", name: "ZAI Coding Plan (China)", iconSrc: zhipuIcon, featured: false },
  { id: "opencode", name: "OpenCode Zen", iconSrc: opencodeIcon, featured: false },
  { id: "opencode-go", name: "OpenCode Go", iconSrc: opencodeIcon, featured: false },
  { id: "radius", name: "Radius", iconSrc: null, featured: false },
  { id: "huggingface", name: "Hugging Face", iconSrc: huggingfaceIcon, featured: false },
  { id: "baseten", name: "Baseten", iconSrc: basetenIcon, featured: false },
  { id: "minimax-cn", name: "MiniMax (China)", iconSrc: minimaxIcon, featured: false },
  { id: "qwen-token-plan-individual", name: "Qwen Token Plan (Individual)", iconSrc: qwenIcon, featured: false },
  { id: "qwen-token-plan-cn", name: "Qwen Token Plan (China)", iconSrc: qwenIcon, featured: false },
  { id: "xiaomi", name: "Xiaomi MiMo", iconSrc: xiaomimimoIcon, featured: false },
  { id: "xiaomi-token-plan-cn", name: "Xiaomi MiMo Token Plan (China)", iconSrc: xiaomimimoIcon, featured: false },
  { id: "xiaomi-token-plan-ams", name: "Xiaomi MiMo Token Plan (Amsterdam)", iconSrc: xiaomimimoIcon, featured: false },
  { id: "xiaomi-token-plan-sgp", name: "Xiaomi MiMo Token Plan (Singapore)", iconSrc: xiaomimimoIcon, featured: false },
];

export interface PiAuthOauthProvider {
  id: string;
  name: string;
  iconSrc: string | null;
  /** pi /login <loginArg> */
  loginArg: string;
  /** i18n key 后缀（settings.vendor.piAuth.oauthDesc.*） */
  descKey: "claude" | "codex" | "copilot" | "xai" | "openrouter" | "radius";
}

/** 订阅授权组：6 项，只读状态 + 终端引导（不发起 OAuth 流程） */
export const PI_AUTH_OAUTH_PROVIDERS: readonly PiAuthOauthProvider[] = [
  { id: "anthropic", name: "Claude Pro / Max", iconSrc: claudeIcon, loginArg: "anthropic", descKey: "claude" },
  { id: "openai", name: "ChatGPT Plus / Pro (Codex)", iconSrc: openaiIcon, loginArg: "openai", descKey: "codex" },
  { id: "github-copilot", name: "GitHub Copilot", iconSrc: copilotIcon, loginArg: "github-copilot", descKey: "copilot" },
  { id: "xai", name: "xAI (Grok / X)", iconSrc: xaiIcon, loginArg: "xai", descKey: "xai" },
  { id: "openrouter", name: "OpenRouter", iconSrc: openrouterIcon, loginArg: "openrouter", descKey: "openrouter" },
  { id: "radius", name: "Radius", iconSrc: null, loginArg: "radius", descKey: "radius" },
];
