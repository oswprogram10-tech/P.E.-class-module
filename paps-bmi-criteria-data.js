(function (root) {
  'use strict';
  const data = {
    schemaVersion: 1,
    catalogVersion: 'moe-school-health-rule-354-2025-03-10-annex4-bmi',
    criteriaVersion: 'MOE-354-2025-03-10-annex4-bmi',
    schoolYear: 2026,
    checkedOn: '2026-11-07',
    grades: ['elementary-3', 'elementary-4', 'elementary-5', 'elementary-6', 'middle-1', 'middle-2', 'middle-3', 'high-1', 'high-2', 'high-3'],
    categories: [
      { id: 'underweight', label: '마름' },
      { id: 'normal', label: '정상' },
      { id: 'overweight', label: '과체중' },
      { id: 'mild-obesity', label: '경도 비만' },
      { id: 'overweight-mild-obesity', label: '과체중·경도 비만 (통합 구간)' },
      { id: 'severe-obesity', label: '고도 비만' },
    ],
    bands: {
      male: [
        [[13.9, 14.0, 20.7, 20.8, 23.2, 23.3, 29.9], [30.0]],
        [[14.2, 14.3, 20.7, 20.8, 23.2, 23.3, 29.9], [30.0]],
        [[14.5, 14.6, 21.6, 21.7, 24.4, 24.5, 29.9], [30.0]],
        [[14.8, 14.9, 22.5, 22.6, 24.9, 25.0, 29.9], [30.0]],
        [[15.3, 15.4, 23.2, 23.3, 24.9, 25.0, 29.9], [30.0]],
        [[15.7, 15.8, 23.8, 23.9, 24.9, 25.0, 29.9], [30.0]],
        [[16.2, 16.3, 24.3, 24.4, 24.9, 25.0, 29.9], [30.0]],
        [[16.7, 16.8, 24.6, 24.7, 24.9, 25.0, 29.9], [30.0]],
        [[17.2, 17.3, 24.9, 25.0, 29.9], [30.0]],
        [[17.7, 17.8, 24.9, 25.0, 29.9], [30.0]],
      ],
      female: [
        [[13.7, 13.8, 19.8, 19.9, 22.0, 22.1, 29.9], [30.0]],
        [[13.9, 14.0, 19.8, 19.9, 22.0, 22.1, 29.9], [30.0]],
        [[14.2, 14.3, 20.6, 20.7, 23.0, 23.1, 29.9], [30.0]],
        [[14.6, 14.7, 21.4, 21.5, 23.9, 24.0, 29.9], [30.0]],
        [[15.1, 15.2, 22.1, 22.2, 24.7, 24.8, 29.9], [30.0]],
        [[15.6, 15.7, 22.7, 22.8, 24.9, 25.0, 29.9], [30.0]],
        [[16.2, 16.3, 23.2, 23.3, 24.9, 25.0, 29.9], [30.0]],
        [[16.7, 16.8, 23.6, 23.7, 24.9, 25.0, 29.9], [30.0]],
        [[17.2, 17.3, 23.8, 23.9, 24.9, 25.0, 29.9], [30.0]],
        [[17.6, 17.7, 23.9, 24.0, 24.9, 25.0, 29.9], [30.0]],
      ],
    },
    source: {
      reviewStatus: 'verified-official',
      publisher: '대한민국 교육부',
      documentTitle: '학교건강검사규칙 (교육부령 제354호, 2025-03-10 시행)',
      documentId: 'moe-school-health-rule-354-2025-03-10',
      url: 'https://www.law.go.kr/법령/학교건강검사규칙',
      reference: '별표 4, PDF 19쪽, 신체능력검사(필수평가) 비만 평가 기준: BMI',
      measurementMethodReference: '별표 3, PDF 14쪽, 체질량지수(BMI): 키·체중으로 계산하고 0.1 kg/m² 단위로 기록(0.01에서 올림)',
      effectiveFrom: '2025-03-10',
      pdfSha256: 'c370d499772929837d35fed32b8d4d8fca195e6e07970b5a8e25efa344bc01e8',
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.PapsBmiCriteriaData = data;
})(globalThis);
