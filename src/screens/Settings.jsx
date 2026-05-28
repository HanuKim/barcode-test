import { useState, useEffect, useRef } from 'react';
import { Settings2, Volume2, Check } from 'lucide-react';
import { ALLERGEN_LIST, speak, stopTTS } from '../utils';

// ================================================================
// 설정 화면 - 알레르기 수정 + TTS 속도 조절
// ================================================================

export default function SettingsScreen() {
  const [ttsRate, setTtsRate] = useState(() =>
    parseFloat(localStorage.getItem('ttsRate') || '1.0')
  );

  const [allergens, setAllergens] = useState(() => {
    const raw = localStorage.getItem('allergy');
    if (!raw || raw === 'none') return [];
    try { return JSON.parse(raw); } catch { return []; }
  });

  const [saved, setSaved] = useState(false);
  const announcedRef = useRef(false);

  useEffect(() => {
    if (announcedRef.current) return;
    announcedRef.current = true;
    speak('설정 화면입니다.');
  }, []);

  const toggleAllergen = (item) => {
    setAllergens((prev) =>
      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]
    );
    speak(item);
    setSaved(false);
  };

  const handleRateChange = (e) => {
    const val = parseFloat(e.target.value);
    setTtsRate(val);
    localStorage.setItem('ttsRate', String(val));
    setSaved(false);
  };

  const testTTS = () => {
    stopTTS();
    speak('현재 설정된 읽기 속도입니다.', ttsRate);
  };

  const handleSave = () => {
    const value = allergens.length > 0 ? JSON.stringify(allergens) : 'none';
    localStorage.setItem('allergy', value);
    localStorage.setItem('ttsRate', String(ttsRate));
    // [Mock] 실제: fetch PUT /api/user/allergy { uuid, allergens }
    setSaved(true);
    speak('설정이 저장되었습니다.');
  };

  return (
    <div className="flex-col gap-md">
      <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Settings2 size={28} color="var(--accent)" />
        설정
      </h2>

      {/* TTS 속도 */}
      <div className="card">
        <div className="setting-row" style={{ borderBottom: 'none' }}>
          <div>
            <p className="setting-label">읽기 속도 (TTS)</p>
            <p className="text-muted" style={{ fontSize: 'var(--fs-xs)' }}>
              0.5x ~ 2.0x
            </p>
          </div>
          <span className="setting-value">{ttsRate.toFixed(1)}x</span>
        </div>
        <div className="slider-container">
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={ttsRate}
            onChange={handleRateChange}
            aria-label={`읽기 속도 ${ttsRate.toFixed(1)}배`}
            id="slider-tts-rate"
          />
        </div>
        <button
          className="btn btn-outline mt-md"
          onClick={testTTS}
          aria-label="읽기 속도 테스트"
          id="btn-test-tts"
          style={{ minHeight: 56 }}
        >
          <Volume2 size={20} /> 속도 테스트
        </button>
      </div>

      {/* 알레르기 수정 */}
      <div className="card">
        <p className="setting-label mb-md">알레르기 정보 수정</p>
        <div className="allergy-grid">
          {ALLERGEN_LIST.map((item) => (
            <button
              key={item}
              className={`allergy-chip ${allergens.includes(item) ? 'selected' : ''}`}
              onClick={() => toggleAllergen(item)}
              aria-label={`${item} ${allergens.includes(item) ? '선택됨' : '선택 안됨'}`}
              aria-pressed={allergens.includes(item)}
              id={`setting-allergy-${item}`}
            >
              {item}
            </button>
          ))}
        </div>

        {allergens.length > 0 && (
          <p className="text-accent mt-md" style={{ fontSize: 'var(--fs-sm)' }}>
            선택됨: {allergens.join(', ')}
          </p>
        )}
      </div>

      {/* 저장 */}
      <button
        className={`btn ${saved ? 'btn-safe' : 'btn-primary'}`}
        onClick={handleSave}
        aria-label="설정 저장"
        id="btn-save-settings"
      >
        {saved ? <><Check size={20} /> 저장 완료</> : '설정 저장'}
      </button>

      {/* 앱 정보 */}
      <div className="card" style={{ marginTop: 8 }}>
        <p className="text-muted" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center' }}>
          알러지 가드 v1.0.0 (프로토타입)<br />
          Capacitor 기반 iOS/Android 하이브리드 앱
        </p>
      </div>
    </div>
  );
}
