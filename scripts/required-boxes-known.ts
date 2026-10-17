/**
 * The lines that break his rule today, each named with what it waits on: the
 * shrinking list of ADR-0161 §2, approved by him on 2026-10-17 ("D1: approved,
 * phased. First build only what unblocks my run and protects every student:
 * the test with its shrinking list, …"; docs/run-a/p318-his-answers-on-adr-0161-as-sent.txt).
 *
 * `scripts/required-boxes-hold.test.ts` fails when a signed entry has a line
 * that is not here (a new break), when a line here no longer occurs (it was
 * mended, so it must leave), and when a line here is not one of the 59 P318
 * listed (`docs/run-a/p318-known-breaks.txt`). So a new break cannot be listed,
 * only mended; the list can only shrink, and each build that mends a class
 * takes its lines off in the same commit.
 *
 * Each key is `blueprintId|class|field|box|detail`, as the checker groups its
 * findings (`findingsFor`). The `waits` text is mine: which row, ADR section or
 * answer of his each line waits on, as the records stood on 2026-10-17.
 */

export interface KnownBreak {
  readonly key: string;
  readonly waits: string;
}

const SHEFFIELD = "bp-sheffield-pgt-september-direct";

const EMPTY_LIST = "row 202 and his D4 (\"build nothing yet\"): nothing built; his observation of the live form first is for jobs only, his words name nothing more for qualifications";
const TOO_LONG = "ADR-0161 §3 case 2 with his D6 (a shorter value for that application only); after phase 1";
const COUNTRIES = "row 212 and his D5: an entry patch for his signature; after phase 1";
const PER_VALUE = "ADR-0158 (a value resolved per application against the live list)";
const YEARS = "row 213 and his D8 (the validator's option rule), then ADR-0161 §3 case 2; after phase 1";
const UK_STUDY = "row 211: an entry patch for the levels' rows (his signature), then his D7; after phase 1";

const lines: readonly (readonly [string, string])[] = [
  ["breaks_a_required_box|contact.address|corrAddress1|maxlength 35", TOO_LONG],
  ["breaks_a_required_box|contact.address|corrTown|maxlength 50", TOO_LONG],
  ["breaks_a_required_box|education.prior_qualifications|certificateStatus|required", EMPTY_LIST],
  ["breaks_a_required_box|education.prior_qualifications|certificateTranslationStatus|required", EMPTY_LIST],
  ["breaks_a_required_box|education.prior_qualifications|degree|required", EMPTY_LIST],
  ["breaks_a_required_box|education.prior_qualifications|endDateMonth|required", EMPTY_LIST],
  ["breaks_a_required_box|education.prior_qualifications|endDateYear|required", EMPTY_LIST],
  ["breaks_a_required_box|education.prior_qualifications|officialCertTranslStatus|required", EMPTY_LIST],
  ["breaks_a_required_box|education.prior_qualifications|officialTranTranslStatus|required", EMPTY_LIST],
  ["breaks_a_required_box|education.prior_qualifications|startDateMonth|required", EMPTY_LIST],
  ["breaks_a_required_box|education.prior_qualifications|startDateYear|required", EMPTY_LIST],
  ["breaks_a_required_box|education.prior_qualifications|transcriptStatus|required", EMPTY_LIST],
  ["breaks_a_required_box|education.prior_qualifications|transcriptTranslationStatus|required", EMPTY_LIST],
  ["breaks_a_required_box|education.prior_qualifications|unlistedDegree|required", EMPTY_LIST],
  ["breaks_a_required_box|employment.history|duties|required", EMPTY_LIST],
  ["breaks_a_required_box|employment.history|employerDetails|required", EMPTY_LIST],
  ["breaks_a_required_box|employment.history|position|maxlength 200, entry 1", TOO_LONG],
  ["breaks_a_required_box|employment.history|position|required", EMPTY_LIST],
  ["breaks_a_required_box|employment.history|startMonth|required", EMPTY_LIST],
  ["breaks_a_required_box|finance.funding|fundingStage|required", "row 209 and his D2: the stage asked after a no, with the form's own words and options; phase 1 (P319)"],
  ["breaks_a_required_box|immigration.uk_study|highestQualificationOther|maxlength 100", TOO_LONG],
  ["breaks_another_box|contact.address|corrIntlPostcode|maxlength 20", TOO_LONG],
  ["breaks_another_box|finance.funding|fundingDetails|maxlength 118", TOO_LONG],
  ["not_one_of_the_box_options|education.prior_qualifications|awardDateYear|no option's value is the text", YEARS],
  ["not_one_of_the_box_options|education.prior_qualifications|endDateYear|no option's value is the text", YEARS],
  ["not_one_of_the_box_options|education.prior_qualifications|startDateYear|no option's value is the text", YEARS],
  ["not_one_of_the_box_options|employment.history|endYear|no option's value is the text", YEARS],
  ["not_one_of_the_box_options|employment.history|startYear|no option's value is the text", YEARS],
  ["not_one_of_the_box_options|identity.date_of_birth|dobYear|no option's value is the text", `${YEARS}; a date of birth no list holds is, in my reading of his D5, a truly impossible case`],
  ["not_one_of_the_box_options|immigration.uk_study|monthsOnStudentVisa|no option's value is the text", YEARS],
  ["not_one_of_the_box_options|immigration.uk_study|visaExpiryYear|no option's value is the text", YEARS],
  ["not_one_of_the_box_options|immigration.uk_study|yearsOnStudentVisa|no option's value is the text", YEARS],
  ["not_one_of_the_box_options|residence.history|dateFromYear1|no option's value is the text", YEARS],
  ["not_one_of_the_box_options|residence.history|dateToYear1|no option's value is the text", YEARS],
  ["not_one_of_the_box_options|residence.uk_entry_date|dateEnteredUKYear|no option's value is the text", YEARS],
  ["offered_but_the_escape_cannot_take_the_words|education.prior_qualifications|degree|render_refused (no_matching_option); the escape's box takes 28", "his D6: a shorter value for that application only; after phase 1"],
  ["refused_by_the_map|contact.address|corrCountry|render_refused (no_matching_option)", COUNTRIES],
  ["refused_by_the_map|contact.address|corrPostcode2|render_refused (rule_does_not_fit)", "his D9: the postcode asked again with the shape the map reads; after phase 1"],
  ["refused_by_the_map|contact.address|corrPostcode|render_refused (rule_does_not_fit)", "his D9: the postcode asked again with the shape the map reads; after phase 1"],
  ["refused_by_the_map|education.prior_qualifications|grade|render_refused (no_matching_case)", PER_VALUE],
  ["refused_by_the_map|education.prior_qualifications|grade|render_refused (no_matching_option)", PER_VALUE],
  ["refused_by_the_map|education.prior_qualifications|gradingSystemId|render_refused (no_matching_case)", PER_VALUE],
  ["refused_by_the_map|education.prior_qualifications|gradingSystemId|render_refused (no_matching_option)", PER_VALUE],
  ["refused_by_the_map|education.prior_qualifications|institution-ts-control|render_refused (no_matching_option)", PER_VALUE],
  ["refused_by_the_map|education.prior_qualifications|institutionCountry-ts-control|render_refused (no_matching_option)", COUNTRIES],
  ["refused_by_the_map|education.prior_qualifications|subjectSearch|render_refused (no_matching_option)", PER_VALUE],
  ["refused_by_the_map|education.prior_qualifications|subject|render_refused (no_matching_option)", PER_VALUE],
  ["refused_by_the_map|finance.funding|fundingSource|render_refused (no_matching_option)", "his D7: the form's own list, with its escape, for a scholarship or loan it does not name; after phase 1"],
  ["refused_by_the_map|finance.funding|fundingSource|render_refused (no_such_part)", "ADR-0161 §3 case 1 (a part a map needs is asked, not offered as none); after phase 1"],
  ["refused_by_the_map|identity.country_of_birth|countryOfBirth|render_refused (no_matching_option)", COUNTRIES],
  ["refused_by_the_map|identity.nationality|fundingNationality|render_refused (no_matching_option)", COUNTRIES],
  ["refused_by_the_map|immigration.uk_study|highestQualification(ENGLISH_LANGUAGE_STUDY)|no_mapping", UK_STUDY],
  ["refused_by_the_map|immigration.uk_study|highestQualification(FOUNDATION_LEVEL)|no_mapping", UK_STUDY],
  ["refused_by_the_map|immigration.uk_study|highestQualification(SCHOOL_LEVEL)|no_mapping", UK_STUDY],
  ["refused_by_the_map|immigration.uk_study|highestQualification(STUDY_ABROAD_OR_EXCHANGE_LEVEL)|no_mapping", UK_STUDY],
  ["refused_by_the_map|immigration.uk_study|highestQualification(UNIVERSITY_LEVEL)|render_refused (no_matching_option)", UK_STUDY],
  ["refused_by_the_map|residence.country|permanentResidence|render_refused (no_matching_option)", COUNTRIES],
  ["refused_by_the_map|residence.history|previousCountry1|list_exceeds_form", "ADR-0161 §7: said at the list's \"another?\" question that the form holds four; in my reading of his D5, a truly impossible case; after phase 1"],
  ["refused_by_the_map|residence.history|previousCountry1|render_refused (no_matching_option)", COUNTRIES],
];

export const KNOWN_BREAKS: readonly KnownBreak[] = lines.map(([line, waits]) => ({ key: `${SHEFFIELD}|${line}`, waits }));
