// Provenance gate for conversion rates. The E3 source `success` flag means
// EPA-positive, so it can never stand in for an extra-point/two-point result.
const SOURCE_METHODS = new Map([
  ['f16616f80adfb4108dd189557d968cdacad680c77eea0bdec1fe46198cb622d0', {
    method: 'epa_success',
    extra_point: 'EPA-positive success flag',
    two_point: 'EPA-positive success flag',
  }],
  ['97f13669b4e6a1c4d25c5be4cf14483a3f47621f4c10106cb24943f35bfbdb3e', {
    method: 'publisher_conversion_result',
    extra_point: 'extra_point_result good/failed',
    two_point: 'two_point_conv_result success/failure',
  }],
  ['04a06c9e80ab99676b8ec76144386ad127c928eb534aa8776895a33418600988', {
    method: 'publisher_conversion_result',
    extra_point: 'extra_point_result good/failed',
    two_point: 'two_point_conv_result success/failure',
  }],
]);

export function auditConversionSource({ producerFileSha256, sourceDescription = '' } = {}) {
  const sha = producerFileSha256?.['scripts/nfl_sequence/measure_kick_outcomes.py'];
  const known = SOURCE_METHODS.get(sha);
  const findings = [];
  const results = {};
  for (const family of ['extra_point', 'two_point']) {
    const semantics = known?.[family] ?? 'unverified source semantics';
    const publisherFieldsPresent = family === 'extra_point'
      ? /extra_point_result/.test(sourceDescription)
      : /two_point_conv_result/.test(sourceDescription);
    const usesEpaSuccess = known?.method === 'epa_success';
    const passes = known?.method === 'publisher_conversion_result' && publisherFieldsPresent && !usesEpaSuccess;
    results[family] = { passed: passes, method: semantics };
    if (!passes) {
      findings.push({
        code: usesEpaSuccess ? 'epa_success_used_for_conversion' : 'conversion_source_unverified',
        family,
        message: usesEpaSuccess
          ? `${family} conversion cannot use EPA-positive success as the make result.`
          : `${family} conversion source is not verified against a publisher outcome field.`,
        producer_script_sha256: sha ?? null,
        observed_semantics: semantics,
      });
    }
  }
  return { passed: findings.length === 0, results, findings };
}
