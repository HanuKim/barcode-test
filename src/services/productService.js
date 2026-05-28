// ================================================================
// 바코드 → 상품 조회 서비스
// 1순위: 푸드QR API (한국 식품, 알레르기 정보)
// 2순위: Open Food Facts API (글로벌, 무료)
// ================================================================

const FOOD_QR_KEY = import.meta.env.VITE_FOOD_QR_KEY;

// 개발: Vite 프록시 경로 사용 (CORS 우회)
// Capacitor 네이티브: CORS 제한 없으므로 직접 URL 사용 가능
function getFoodQRBase() {
  const isCapacitor = typeof window !== 'undefined' && (
    window.Capacitor ||
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'app:' ||
    window.location.href.includes('capacitor://')
  );
  return isCapacitor
    ? 'https://foodqr.kr/openapi/service/qr1009/F009'
    : '/api/foodqr/qr1009/F009';
}

const ALLERGEN_MAP_KO = {
  'en:gluten': '밀',
  'en:milk': '우유',
  'en:eggs': '난류',
  'en:peanuts': '땅콩',
  'en:soybeans': '대두',
  'en:nuts': '견과류',
  'en:fish': '생선',
  'en:crustaceans': '갑각류',
  'en:celery': '셀러리',
  'en:mustard': '겨자',
  'en:sesame-seeds': '참깨',
  'en:sulphur-dioxide-and-sulphites': '아황산류',
  'en:lupin': '루핀',
  'en:molluscs': '조개류',
  'en:wheat': '밀',
};

// 한국어 알레르기 키워드 매핑 (성분 텍스트에서 검출)
const KO_ALLERGEN_KEYWORDS = [
  { keyword: '우유', allergen: '우유' },
  { keyword: '원유', allergen: '우유' },
  { keyword: '탈지분유', allergen: '우유' },
  { keyword: '전지분유', allergen: '우유' },
  { keyword: '유크림', allergen: '우유' },
  { keyword: '버터', allergen: '우유' },
  { keyword: '치즈', allergen: '우유' },
  { keyword: '유청', allergen: '우유' },
  { keyword: '카제인', allergen: '우유' },
  { keyword: '계란', allergen: '난류' },
  { keyword: '난백', allergen: '난류' },
  { keyword: '난황', allergen: '난류' },
  { keyword: '달걀', allergen: '난류' },
  { keyword: '땅콩', allergen: '땅콩' },
  { keyword: '대두', allergen: '대두' },
  { keyword: '콩', allergen: '대두' },
  { keyword: '두부', allergen: '대두' },
  { keyword: '밀가루', allergen: '밀' },
  { keyword: '소맥분', allergen: '밀' },
  { keyword: '밀', allergen: '밀' },
  { keyword: '글루텐', allergen: '밀' },
  { keyword: '메밀', allergen: '메밀' },
  { keyword: '고등어', allergen: '고등어' },
  { keyword: '게', allergen: '게' },
  { keyword: '새우', allergen: '새우' },
  { keyword: '돼지', allergen: '돼지고기' },
  { keyword: '복숭아', allergen: '복숭아' },
  { keyword: '토마토', allergen: '토마토' },
  { keyword: '호두', allergen: '호두' },
  { keyword: '닭', allergen: '닭고기' },
  { keyword: '쇠고기', allergen: '쇠고기' },
  { keyword: '소고기', allergen: '쇠고기' },
  { keyword: '오징어', allergen: '오징어' },
  { keyword: '조개', allergen: '조개류' },
  { keyword: '잣', allergen: '잣' },
  { keyword: '아황산', allergen: '아황산류' },
];

/**
 * 성분 텍스트에서 알레르기 성분 추출
 */
function extractAllergensFromText(text) {
  if (!text) return [];
  const found = new Set();
  const lower = text.toLowerCase();
  for (const { keyword, allergen } of KO_ALLERGEN_KEYWORDS) {
    if (lower.includes(keyword)) found.add(allergen);
  }
  return [...found];
}

/**
 * 성분 텍스트를 리스트로 파싱
 */
function parseIngredients(text) {
  if (!text) return [];
  return text
    .replace(/[\[\](){}]/g, ',')
    .split(/[,;·•]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 50);
}

// ================================================================
// 1순위: 푸드QR API (한국 식품 알레르기 정보)
// ================================================================
async function fetchFromFoodQR(barcode) {
  try {
    // 바코드 앞에 0 패딩 (14자리) — API 요구사항에 맞춤
    const paddedBarcode = barcode.padStart(14, '0');
    const params = new URLSearchParams({
      accessKey: FOOD_QR_KEY,
      numOfRows: '20',
      pageNo: '1',
      _type: 'json',
      brcdNo: paddedBarcode,
    });

    const res = await fetch(`${getFoodQRBase()}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const body = data?.response?.body;

    if (!body || body.totalCount === 0) {
      // 패딩 없이 재시도
      if (paddedBarcode !== barcode) {
        const params2 = new URLSearchParams({
          accessKey: FOOD_QR_KEY,
          numOfRows: '20',
          pageNo: '1',
          _type: 'json',
          brcdNo: barcode,
        });
        const res2 = await fetch(`${getFoodQRBase()}?${params2}`);
        if (!res2.ok) return null;
        const data2 = await res2.json();
        const body2 = data2?.response?.body;
        if (!body2 || body2.totalCount === 0) return null;
        return parseFoodQRResponse(body2, barcode);
      }
      return null;
    }

    return parseFoodQRResponse(body, barcode);
  } catch (err) {
    console.warn('FoodQR API error:', err);
    return null;
  }
}

function parseFoodQRResponse(body, barcode) {
  const rawItems = body.items?.item;
  if (!rawItems) return null;

  // 단일 항목이면 배열로 변환
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  // 제품명 (첫 번째 항목에서)
  const name = items[0].prdctNm || items[0].indctGroupNm || '상품명 없음';

  // 알레르기 성분 수집 (각 row가 알레르기 1개)
  const allergens = [...new Set(
    items
      .map((item) => item.algCsgMtrNm)
      .filter(Boolean)
      .map((a) => a.trim())
  )];

  return {
    found: true,
    name,
    barcode,
    ingredients: allergens.length > 0
      ? [`알레르기 유발 성분: ${allergens.join(', ')}`]
      : ['알레르기 유발 성분 없음'],
    allergens,
    recalled: false,
    source: '푸드QR (식품안전나라)',
  };
}

// ================================================================
// 2순위: Open Food Facts API
// ================================================================
async function fetchFromOpenFoodFacts(barcode) {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}?fields=product_name,product_name_ko,brands,ingredients_text,ingredients_text_ko,allergens_tags,traces_tags,image_url`,
      { headers: { 'User-Agent': 'AllergyGuard/1.0 (capacitor-prototype)' } }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    const name = p.product_name_ko || p.product_name || '이름 없음';
    const brand = p.brands || '';
    const ingredientsText = p.ingredients_text_ko || p.ingredients_text || '';
    const ingredients = parseIngredients(ingredientsText);

    // 알레르기: API 태그 + 텍스트 분석
    const apiAllergens = (p.allergens_tags || [])
      .map((tag) => ALLERGEN_MAP_KO[tag])
      .filter(Boolean);
    const traceAllergens = (p.traces_tags || [])
      .map((tag) => ALLERGEN_MAP_KO[tag])
      .filter(Boolean);
    const textAllergens = extractAllergensFromText(ingredientsText);
    const allergens = [...new Set([...apiAllergens, ...traceAllergens, ...textAllergens])];

    return {
      found: true,
      name: brand ? `${brand} ${name}` : name,
      barcode,
      ingredients: ingredients.length > 0 ? ingredients : [ingredientsText || '성분 정보 없음'],
      allergens,
      recalled: false,
      imageUrl: p.image_url || null,
      source: 'Open Food Facts',
    };
  } catch (err) {
    console.warn('OpenFoodFacts API error:', err);
    return null;
  }
}

// ================================================================
// 통합 조회 — 1순위 푸드QR → 2순위 OFF → 미등록
// ================================================================
export async function fetchProduct(barcode) {
  // 1) 푸드QR API (한국 식품)
  const foodQR = await fetchFromFoodQR(barcode);
  if (foodQR) return foodQR;

  // 2) Open Food Facts (글로벌)
  const off = await fetchFromOpenFoodFacts(barcode);
  if (off) return off;

  // 3) 둘 다 없음
  return { found: false, barcode };
}
