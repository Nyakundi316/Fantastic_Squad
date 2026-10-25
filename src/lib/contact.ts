const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalises a phone number to E.164. Local Nigerian formats are assumed when
 * no country code is given: 0803 000 0000 → +2348030000000.
 */
export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s\-().]/g, "");
  if (!compact) return null;

  let candidate: string;
  if (compact.startsWith("+")) candidate = compact;
  else if (compact.startsWith("00")) candidate = `+${compact.slice(2)}`;
  else if (compact.startsWith("234")) candidate = `+${compact}`;
  else if (/^0[789]\d{9}$/.test(compact)) candidate = `+234${compact.slice(1)}`;
  else if (/^[789]\d{9}$/.test(compact)) candidate = `+234${compact}`;
  else return null;

  return E164.test(candidate) ? candidate : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  return EMAIL.test(value) && value.length <= 254 ? value : null;
}

/** +2348030000004 → +234 803 *** 0004, for confirmation screens. */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return e164;
  const country = e164.startsWith("+234") ? "+234" : e164.slice(0, 3);
  const rest = e164.slice(country.length);
  return `${country} ${rest.slice(0, 3)} *** ${rest.slice(-4)}`;
}
