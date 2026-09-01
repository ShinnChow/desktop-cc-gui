const onboarding = {
  onboarding: {
    welcome: {
      title: "欢迎使用 CC GUI",
      subtitle: "实现一亿人的编程梦想",
      start: "开始使用",
    },
    ide: {
      title: "你平时用什么编辑器？",
      subtitle: "会影响部分功能展示逻辑，后续可在设置里面更改",
      vscode: {
        title: "VS Code",
        hint: "从这里打开文件和文件夹。",
      },
      cursor: {
        title: "Cursor",
        hint: "继续用你现在的 AI 编辑器。",
      },
      idea: {
        title: "IntelliJ IDEA",
        hint: "适合 JetBrains 工作流。",
      },
      zed: {
        title: "Zed",
        hint: "轻量、偏键盘的编辑器。",
      },
      sublime: {
        title: "Sublime Text",
        hint: "打开文件时走 Sublime。",
      },
      none: {
        title: "都没使用过",
        hint: "先用 CC GUI，后续再在设置里选编辑器。"
      },
    },
    cli: {
      title: "安装你的第一个 AI 引擎",
      subtitle: "至少安装一个即可进入。也可以先逛，稍后再装。",
      continueReady: "继续",
      skip: "稍后设置",
      install: "安装",
      installing: "正在安装…",
      validate: "测试",
      validating: "正在测试…",
      version: "版本 {{version}}",
      statusReady: "已通过",
      statusInstalled: "已安装",
      statusChecking: "检查中",
      statusMissing: "未安装",
      showMore: "更多引擎",
      hideMore: "收起更多",
      detectFailed: "暂时无法检测本机引擎。",
      validateFailed: "测试没有通过，可以重试或换一个引擎。",
      installFailed: "安装没有完成，可以重试或稍后在设置里继续。",
      installBlocked: "当前环境还不能自动安装，请先看设置里的说明。",
    },
    engine: {
      claude: {
        title: "Claude Code",
        hint: "适合大多数新用户，安装比较直接。",
      },
      codex: {
        title: "Codex CLI",
        hint: "OpenAI 的编程引擎，适合已经在用 Codex 的人。",
      },
      grok: {
        title: "Grok CLI",
        hint: "可选引擎，装好后即可使用。",
      },
      kimi: {
        title: "Kimi CLI",
        hint: "可选引擎，适合已经有 Kimi 环境的人。",
      },
      opencode: {
        title: "OpenCode",
        hint: "可选引擎，按需安装。",
      },
      dsh: {
        title: "DeepSeek Harness",
        hint: "本机已有 DSH 时可以直接使用。",
      },
      pi: {
        title: "PI CLI",
        hint: "可选引擎，按需安装。",
      },
      omp: {
        title: "OMP CLI",
        hint: "可选引擎，按需安装。",
      },
      qoder: {
        title: "Qoder CLI",
        hint: "可选引擎，按需安装。登录请使用 qodercli login。",
      },
    },
    done: {
      title: "可以开始了",
      subtitle: "这些选择之后都能改。",
      enter: "进入 CC GUI",
      ide: "编辑器",
      engine: "引擎",
      unset: "未选择",
      cliSkipped: "稍后设置",
    },
    common: {
      continue: "继续",
      back: "返回",
      skipAll: "跳过所有",
    },
    banner: {
      message: "还没有安装可用的 AI 引擎，发消息前建议先完成这一步。",
      action: "继续设置",
    },
  },
};

export default onboarding;
