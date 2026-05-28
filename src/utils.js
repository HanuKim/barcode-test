// ================================================================
// 알러지 가드 - 유틸리티 & Mock 데이터
// ================================================================

// [Capacitor] 실제: import { Device } from '@capacitor/device'
// [검증] iOS/Android 모두 Capacitor Device 플러그인으로 동일 API 사용 가능
export const Platform = {
  isIOS: /iPhone|iPad|iPod/.test(navigator.userAgent),
  isAndroid: /Android/.test(navigator.userAgent),
  isWeb: !(/iPhone|iPad|iPod|Android/.test(navigator.userAgent)),
};

// ----------------------------------------------------------------
// UUID
// ----------------------------------------------------------------
export function getOrCreateUUID() {
  let uuid = localStorage.getItem('uuid');
  if (!uuid) {
    uuid = 'usr-' + crypto.randomUUID();
    localStorage.setItem('uuid', uuid);
  }
  return uuid;
}

// ----------------------------------------------------------------
// 알레르기 항목
// ----------------------------------------------------------------
export const ALLERGEN_LIST = [
  '난류', '우유', '메밀', '땅콩', '대두', '밀',
  '고등어', '게', '새우', '돼지고기', '복숭아', '토마토',
  '아황산류', '호두', '닭고기', '쇠고기', '오징어', '조개류', '잣',
];

// ----------------------------------------------------------------
// Mock 상품 데이터
// ----------------------------------------------------------------
export const MOCK_PRODUCTS = {
  SAFE: {
    name: '서울우유 흰우유 200ml',
    barcode: '8801115114159',
    ingredients: ['원유', '비타민D'],
    allergens: [],
    recalled: false,
  },
  DANGER: {
    name: '○○ 땅콩과자',
    barcode: '8800000000001',
    ingredients: ['밀가루', '땅콩', '설탕', '팜유', '소금'],
    allergens: ['밀', '땅콩'],
    recalled: false,
  },
  RECALL: {
    name: '△△ 음료수',
    barcode: '8800000000002',
    ingredients: ['정제수', '액상과당', '구연산'],
    allergens: [],
    recalled: true,
    recallInfo: '이물질 혼입으로 인한 자진 회수 (2025.03.10)',
  },
};

// ----------------------------------------------------------------
// TTS (Web Speech API mock for Capacitor TTS)
// ----------------------------------------------------------------
// [Capacitor] 실제: import { TextToSpeech } from '@capacitor-community/text-to-speech'
// [Mock] 실제 연동 시 이 블록을 Capacitor 플러그인 호출로 교체

let ttsQueue = [];
let ttsActive = false;
let lastToastTime = 0; // 토스트 스팸 방지

export function speak(text, rate = null) {
  if (!text) return;
  const r = rate ?? parseFloat(localStorage.getItem('ttsRate') || '1.0');

  if (!window.speechSynthesis) {
    // 토스트 폴백: 3초에 1회만
    const now = Date.now();
    if (now - lastToastTime > 3000) {
      lastToastTime = now;
      showToastGlobal?.(text);
    }
    return;
  }

  ttsQueue.push({ text, rate: r });
  if (!ttsActive) processTTSQueue();
}

function processTTSQueue() {
  if (ttsQueue.length === 0) { ttsActive = false; return; }
  ttsActive = true;
  const { text, rate } = ttsQueue.shift();

  // iOS SSML Parser Error 방지를 위한 텍스트 클렌징
  // (XML 특수문자, 따옴표, 괄호 및 특수 기호/이모지 제거)
  const cleanText = text
    .replace(/[&<>"']/g, '') // XML 엔티티 브레이커 제거
    .replace(/[()[\]{}]/g, ' ') // 괄호를 공백으로 대체
    .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '') // 이모지 제거
    .replace(/\s+/g, ' ') // 연속 공백 단일화
    .trim();

  if (!cleanText) {
    processTTSQueue();
    return;
  }

  const utter = new SpeechSynthesisUtterance(cleanText);
  utter.lang = 'ko-KR';
  utter.rate = rate;
  utter.pitch = 1.0;
  utter.volume = 1.0;
  utter.onend = () => processTTSQueue();
  utter.onerror = () => {
    // TTS 에러 시 토스트 폴백 — 스팸 방지
    const now = Date.now();
    if (now - lastToastTime > 3000) {
      lastToastTime = now;
      showToastGlobal?.(cleanText);
    }
    processTTSQueue();
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

export function stopTTS() {
  ttsQueue = [];
  ttsActive = false;
  window.speechSynthesis?.cancel();
}

// Global toast callback (set by App)
let showToastGlobal = null;
export function setToastCallback(fn) { showToastGlobal = fn; }

// ----------------------------------------------------------------
// Haptics
// ----------------------------------------------------------------
// [Capacitor] 실제: import { Haptics, ImpactStyle } from '@capacitor/haptics'
// [Mock] 실제 연동 시 이 블록을 Capacitor 플러그인 호출로 교체
export function hapticImpact() {
  // [Capacitor] 실제: await Haptics.impact({ style: ImpactStyle.Medium });
  try { navigator.vibrate?.(50); } catch { /* 미지원 시 무시 */ }
}

export function hapticWarning() {
  // [Capacitor] 실제: await Haptics.vibrate({ duration: 500 });
  try { navigator.vibrate?.(500); } catch { /* 미지원 시 무시 */ }
}

// ----------------------------------------------------------------
// Web Audio - 비프음 (모바일 AudioContext unlock 대응)
// ----------------------------------------------------------------
let audioCtx = null;
let audioUnlocked = false;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// 모바일: 첫 사용자 터치에서 AudioContext를 unlock
export function unlockAudio() {
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => { audioUnlocked = true; });
  } else {
    audioUnlocked = true;
  }
  // 무음 버퍼를 재생하여 iOS Safari에서도 unlock
  if (!audioUnlocked) {
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch { /* ignore */ }
  }
}

// 페이지 첫 터치/클릭에서 자동 unlock
if (typeof document !== 'undefined') {
  const handleFirstInteraction = () => {
    unlockAudio();
    document.removeEventListener('touchstart', handleFirstInteraction);
    document.removeEventListener('click', handleFirstInteraction);
  };
  document.addEventListener('touchstart', handleFirstInteraction, { passive: true });
  document.addEventListener('click', handleFirstInteraction, { passive: true });
}

export function playBeep(freq = 800, duration = 150, volume = 0.3) {
  try {
    const ctx = getAudioCtx();
    // 매 호출 시 resume 시도 (suspended 상태일 수 있음)
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration / 1000);
  } catch { /* ignore */ }
}

export function playSuccessSound() {
  playBeep(880, 100, 0.3);
  setTimeout(() => playBeep(1100, 150, 0.3), 120);
}

export function playWarningSound() {
  playBeep(400, 200, 0.5);
  setTimeout(() => playBeep(300, 300, 0.5), 250);
}

// ----------------------------------------------------------------
// STT 명령어
// ----------------------------------------------------------------
export const STT_COMMANDS = [
  { label: '"스캔"', desc: '스캔 화면 이동', command: '스캔' },
  { label: '"뒤로"', desc: '이전 화면', command: '뒤로' },
  { label: '"알레르기 설정"', desc: '설정 화면', command: '알레르기 설정' },
  { label: '"결과 읽어줘"', desc: '현재 결과 TTS 재생', command: '결과 읽어줘' },
  { label: '"처음으로"', desc: '메인 화면', command: '처음으로' },
];
