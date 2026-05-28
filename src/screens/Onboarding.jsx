import { useState, useEffect, useRef } from 'react';
import { Shield, ChevronRight } from 'lucide-react';
import { ALLERGEN_LIST, getOrCreateUUID, speak } from '../utils';

// ================================================================
// 온보딩 화면 - UUID 발급 + 알레르기 등록
// ================================================================
export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0); // 0: welcome, 1: allergy select
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const announcedRef = useRef(false);

  useEffect(() => {
    if (announcedRef.current) return;
    announcedRef.current = true;
    speak('알러지 가드에 오신 것을 환영합니다. 시작하기 버튼을 눌러주세요.');
  }, []);

  // Step 0 → 1: UUID 발급
  const handleStart = () => {
    setLoading(true);
    // [Mock] 실제: fetch POST /api/user/register + UUID 발급
    // [Capacitor] 실제: import { Device } from '@capacitor/device'; const info = await Device.getId();
    setTimeout(() => {
      getOrCreateUUID();
      setLoading(false);
      setStep(1);
      speak('알레르기 정보를 등록해주세요. 해당하는 항목을 선택 후 완료 버튼을 눌러주세요.');
    }, 500);
  };

  const toggleAllergen = (item) => {
    setSelected((prev) =>
      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]
    );
    // 포커스 시 TTS
    speak(item);
  };

  const handleComplete = () => {
    const value = selected.length > 0 ? JSON.stringify(selected) : 'none';
    localStorage.setItem('allergy', value);

    // [Mock] 실제: fetch POST /api/user/allergy { uuid, allergens: selected }
    const msg = selected.length > 0
      ? `${selected.join(', ')} 알레르기가 등록되었습니다.`
      : '알레르기 정보 없이 진행합니다.';
    speak(msg);
    onComplete();
  };

  if (step === 0) {
    return (
      <div className="onboarding-container">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="onboarding-hero">
            <div className="flex-center" style={{ marginBottom: 24 }}>
              <div style={{
                width: 96, height: 96, borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--accent), #FFA500)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Shield size={48} color="#000" />
              </div>
            </div>
            <h2>알러지 가드</h2>
            <p style={{ marginTop: 8 }}>
              바코드 스캔으로<br />
              알레르기·리콜 정보를<br />
              빠르게 확인하세요
            </p>
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleStart}
          disabled={loading}
          aria-label="시작하기"
          id="btn-start"
        >
          {loading ? <div className="loading-spinner" style={{ width: 24, height: 24, margin: 0, borderWidth: 3 }} /> : (
            <>시작하기 <ChevronRight size={24} /></>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="onboarding-container">
      <div className="onboarding-step">STEP 2/2</div>
      <h2 className="section-title">알레르기 정보 등록</h2>
      <p className="section-desc">
        해당하는 알레르기 항목을 모두 선택해주세요.<br />
        없으면 바로 완료를 눌러주세요.
      </p>

      <div className="allergy-grid">
        {ALLERGEN_LIST.map((item) => (
          <button
            key={item}
            className={`allergy-chip ${selected.includes(item) ? 'selected' : ''}`}
            onClick={() => toggleAllergen(item)}
            aria-label={`${item} ${selected.includes(item) ? '선택됨' : '선택 안됨'}`}
            aria-pressed={selected.includes(item)}
            id={`allergy-${item}`}
          >
            {item}
          </button>
        ))}
      </div>

      {selected.length > 0 && (
        <p className="text-accent mt-md" style={{ fontSize: 'var(--fs-sm)' }}>
          선택됨: {selected.join(', ')}
        </p>
      )}

      <div style={{ marginTop: 'auto', paddingTop: 24 }}>
        <button
          className="btn btn-primary"
          onClick={handleComplete}
          aria-label={`완료. ${selected.length}개 선택됨`}
          id="btn-onboarding-complete"
        >
          완료 ({selected.length}개 선택)
        </button>
      </div>
    </div>
  );
}
