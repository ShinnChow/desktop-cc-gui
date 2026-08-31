import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMonthlyBudgetConfig } from "../../../../context-ledger/cost-budget";

function parseBudgetInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function CostBudgetSettingsSection() {
  const { t } = useTranslation();
  const [budget, actions] = useMonthlyBudgetConfig();
  const [draft, setDraft] = useState(
    () => budget.monthlyLimitUsd?.toString() ?? "",
  );

  useEffect(() => {
    setDraft(budget.monthlyLimitUsd?.toString() ?? "");
  }, [budget.monthlyLimitUsd]);

  const parsedDraft = parseBudgetInput(draft);
  const canSave = draft.trim() === "" || parsedDraft != null;

  return (
    <div className="settings-budget-card">
      <div className="settings-subsection-title">
        {t("settings.costBudgetTitle")}
      </div>
      <div className="settings-subsection-subtitle">
        {t("settings.costBudgetDescription")}
      </div>
      <div className="settings-budget-row">
        <label className="settings-budget-field">
          <span>{t("settings.costBudgetMonthlyLimit")}</span>
          <input
            className="settings-input"
            inputMode="decimal"
            min="0"
            placeholder="25"
            type="number"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="settings-button"
          disabled={!canSave}
          onClick={() => actions.setMonthlyLimitUsd(parsedDraft)}
        >
          {t("settings.costBudgetSave")}
        </button>
        <button
          type="button"
          className="settings-button secondary"
          onClick={() => actions.clear()}
        >
          {t("settings.costBudgetClear")}
        </button>
      </div>
      <div className="settings-help">
        {budget.monthlyLimitUsd == null
          ? t("settings.costBudgetUnset")
          : t("settings.costBudgetCurrent", {
              amount: `$${budget.monthlyLimitUsd.toFixed(2)}`,
            })}
      </div>
      {actions.degraded ? (
        <div className="settings-inline-error" role="alert">
          {t("settings.costBudgetStorageDegraded")}
        </div>
      ) : null}
    </div>
  );
}


