/**
 * The countries the test portals offer (P298, row 157).
 *
 * Until P298 both test portals offered Iran, Iraq and the United Kingdom, and
 * mapped the nationality from a demonym ("Iranian" → IR) — while the interview
 * has stored the ISO code since P199, so a profile the interview made was
 * refused at the nationality on both, and they could carry no student but one
 * fed "Iranian" by hand. Now the mapping is the interview's ISO code to the
 * portal's own value, and the portals offer the countries his test plan names:
 * India, Nigeria, Pakistan, Bangladesh and the six Gulf states, beside the
 * three they had. Test portals, written here; not a university's list.
 */
export const FIXTURE_COUNTRIES: readonly { readonly value: string; readonly label: string }[] = [
  { value: "IR", label: "Iran (Islamic Republic of)" },
  { value: "IQ", label: "Iraq" },
  { value: "GB", label: "United Kingdom" },
  { value: "IN", label: "India" },
  { value: "NG", label: "Nigeria" },
  { value: "PK", label: "Pakistan" },
  { value: "BD", label: "Bangladesh" },
  { value: "AE", label: "United Arab Emirates" },
  { value: "SA", label: "Saudi Arabia" },
  { value: "QA", label: "Qatar" },
  { value: "KW", label: "Kuwait" },
  { value: "OM", label: "Oman" },
  { value: "BH", label: "Bahrain" },
];

/** The mapping's rows: the ISO code the interview stores, to the test portal's own value, one for one. */
export const FIXTURE_COUNTRY_OPTIONS: Readonly<Record<string, string>> = Object.fromEntries(
  FIXTURE_COUNTRIES.map((country) => [country.value, country.value]),
);
