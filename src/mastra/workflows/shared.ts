import { currentDateKey, currentMonthKey } from "../../finance/dates";
import { formatMoney } from "../../finance/money";
import {
  getOrCreateUser,
  type ForecastResult,
  type ForecastRow,
} from "../../finance/profile-service";
import { getUserProfile } from "../../finance/user-preferences";

type ProfileSettings = {
  defaultCurrency?: string | null;
  timezone?: string | null;
};

export const missingProfileSettings = (user: ProfileSettings) => {
  const missing: string[] = [];
  if (!user.defaultCurrency) missing.push("defaultCurrency");
  if (!user.timezone) missing.push("timezone");
  return missing;
};

export const resolveCurrentDate = (settings: ProfileSettings, now = new Date()) => ({
  currentDate: settings.timezone ? currentDateKey(settings.timezone, now) : null,
  currentMonth: settings.timezone ? currentMonthKey(settings.timezone, now) : null,
});

export const currentContext = (settings: ProfileSettings, now = new Date()) => ({
  ...resolveCurrentDate(settings, now),
  missingProfileFields: missingProfileSettings(settings),
});

export const loadUserContext = async (mastraResourceId: string) => {
  const user = await getOrCreateUser({ mastraResourceId });
  const profile = await getUserProfile(user.id);
  const missingProfileFields = missingProfileSettings(user);

  return {
    ok: missingProfileFields.length === 0,
    mastraResourceId,
    user,
    profile,
    userId: user.id,
    currency: user.defaultCurrency ?? undefined,
    timezone: user.timezone ?? undefined,
    missingProfileFields,
    ...resolveCurrentDate(user),
  };
};

export const buildForecastImpact = ({
  before,
  after,
  currency,
}: {
  before: Pick<ForecastResult, "minimumFreeCashMinor"> & {
    rows: ForecastRow[];
  };
  after: Pick<ForecastResult, "minimumFreeCashMinor"> & {
    rows: ForecastRow[];
  };
  currency: string;
}) => {
  const beforeByMonth = new Map(before.rows.map((row) => [row.month, row]));
  const rows = after.rows.map((afterRow) => {
    const beforeRow = beforeByMonth.get(afterRow.month);
    const deltaMinor =
      afterRow.closingFreeCashMinor - (beforeRow?.closingFreeCashMinor ?? 0);
    return {
      month: afterRow.month,
      beforeClosingFreeCashMinor: beforeRow?.closingFreeCashMinor ?? 0,
      afterClosingFreeCashMinor: afterRow.closingFreeCashMinor,
      deltaMinor,
      formattedDelta: formatMoney(deltaMinor, currency),
      riskLevel: afterRow.riskLevel,
    };
  });

  return {
    minimumFreeCashDeltaMinor:
      after.minimumFreeCashMinor - before.minimumFreeCashMinor,
    formattedMinimumFreeCashDelta: formatMoney(
      after.minimumFreeCashMinor - before.minimumFreeCashMinor,
      currency,
    ),
    rows,
  };
};
