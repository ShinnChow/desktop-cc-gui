const onboarding = {
  onboarding: {
    welcome: {
      title: "Welcome to CC GUI",
      subtitle: "Realize the programming dreams of 100 million people",
      start: "Get started",
    },
    ide: {
      title: "Which editor do you use?",
      subtitle: "This changes some feature presentation. You can update it later in Settings.",
      vscode: {
        title: "VS Code",
        hint: "Open files and folders from here.",
      },
      cursor: {
        title: "Cursor",
        hint: "Stay with your current AI editor.",
      },
      idea: {
        title: "IntelliJ IDEA",
        hint: "Best if you already live in JetBrains.",
      },
      zed: {
        title: "Zed",
        hint: "A lighter, keyboard-first editor.",
      },
      sublime: {
        title: "Sublime Text",
        hint: "Open files in Sublime.",
      },
      none: {
        title: "I haven’t used any of these",
        hint: "Stay in CC GUI for now. You can pick an editor later in Settings."
      },
    },
    cli: {
      title: "Set up your first AI engine",
      subtitle: "Install one engine to continue, or skip and finish later.",
      continueReady: "Continue",
      skip: "Set up later",
      install: "Install",
      installing: "Installing…",
      validate: "Test",
      validating: "Testing…",
      version: "Version {{version}}",
      statusReady: "Ready",
      statusInstalled: "Installed",
      statusChecking: "Checking",
      statusMissing: "Not installed",
      showMore: "More engines",
      hideMore: "Hide extra engines",
      detectFailed: "Could not detect local engines right now.",
      validateFailed: "The test did not pass. Retry or pick another engine.",
      installFailed: "Install did not finish. Retry or continue in Settings.",
      installBlocked: "Automatic install is blocked in this environment.",
    },
    engine: {
      claude: {
        title: "Claude Code",
        hint: "The most straightforward first engine for most people.",
      },
      codex: {
        title: "Codex CLI",
        hint: "OpenAI’s coding engine, if you already use Codex.",
      },
      grok: {
        title: "Grok CLI",
        hint: "Optional. Use it here after install.",
      },
      kimi: {
        title: "Kimi CLI",
        hint: "Optional, if you already have a Kimi setup.",
      },
      opencode: {
        title: "OpenCode",
        hint: "Optional. Install only if you need it.",
      },
      dsh: {
        title: "DeepSeek Harness",
        hint: "Use it here if DSH is already on this machine.",
      },
      pi: {
        title: "PI CLI",
        hint: "Optional. Install only if you need it.",
      },
      omp: {
        title: "OMP CLI",
        hint: "Optional. Install only if you need it.",
      },
      qoder: {
        title: "Qoder CLI",
        hint: "Optional. Install only if you need it.",
      },
    },
    done: {
      title: "You’re ready",
      subtitle: "You can change any of this later.",
      enter: "Enter CC GUI",
      ide: "Editor",
      engine: "Engine",
      unset: "Not set",
      cliSkipped: "Set up later",
    },
    common: {
      continue: "Continue",
      back: "Back",
      skipAll: "Skip all",
    },
    banner: {
      message: "No AI engine is installed yet. Finish this before you send.",
      action: "Continue setup",
    },
  },
};

export default onboarding;
