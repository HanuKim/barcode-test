import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, ScanLine, ClipboardList, Settings2, Mic, MicOff } from 'lucide-react';
import { speak, stopTTS, setToastCallback, STT_COMMANDS, unlockAudio } from './utils';
import Onboarding from './screens/Onboarding';
import Scanner from './screens/Scanner';
import Result from './screens/Result';
import SettingsScreen from './screens/Settings';

// ================================================================
// 알러지 가드 - 메인 App
// 실제 음성 입력(Web Speech API) + Capacitor 하이브리드
// ================================================================

const SpeechRecognitionAPI = typeof window !== 'undefined'
  && (window.SpeechRecognition || window.webkitSpeechRecognition);

function App() {
  const [screen, setScreen] = useState('loading');
  const [resultProduct, setResultProduct] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [sttOpen, setSttOpen] = useState(false);
  const [sttListening, setSttListening] = useState(false);
  const [sttTranscript, setSttTranscript] = useState('');
  const [prevScreen, setPrevScreen] = useState('scanner');
  const recognitionRef = useRef(null);

  // Toast
  const toastCounter = useRef(0);
  const showToast = useCallback((text) => {
    const id = `${Date.now()}-${toastCounter.current++}`;
    setToasts((prev) => [...prev.slice(-2), { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  useEffect(() => { setToastCallback(showToast); }, [showToast]);

  useEffect(() => {
    const hasAllergy = localStorage.getItem('allergy');
    setScreen(hasAllergy ? 'scanner' : 'onboarding');
  }, []);

  const navigateTo = useCallback((target) => {
    stopTTS();
    setPrevScreen(screen);
    setScreen(target);
  }, [screen]);

  const handleResult = (product) => {
    setResultProduct(product);
    navigateTo('result');
  };

  // ── 음성 명령 키워드 매칭 ──
  const matchCommand = useCallback((text) => {
    const t = text.trim();
    const commands = [
      { keywords: ['스캔', '바코드'], action: '스캔' },
      { keywords: ['뒤로', '이전', '돌아가'], action: '뒤로' },
      { keywords: ['알레르기', '설정', '알러지'], action: '알레르기 설정' },
      { keywords: ['결과', '읽어', '알려'], action: '결과 읽어줘' },
      { keywords: ['처음', '메인', '홈'], action: '처음으로' },
    ];
    for (const { keywords, action } of commands) {
      if (keywords.some((kw) => t.includes(kw))) return action;
    }
    return null;
  }, []);

  // ── 음성 인식 제어 ──
  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    setSttListening(false);
  }, []);

  const handleVoiceCommand = useCallback((command) => {
    stopRecognition();
    setSttOpen(false);
    setSttTranscript('');

    switch (command) {
      case '스캔':
        navigateTo('scanner');
        speak('스캔 화면으로 이동합니다.');
        break;
      case '뒤로':
        navigateTo(prevScreen);
        speak('이전 화면으로 돌아갑니다.');
        break;
      case '알레르기 설정':
        navigateTo('settings');
        speak('설정 화면으로 이동합니다.');
        break;
      case '결과 읽어줘':
        if (screen === 'result' && resultProduct) {
          speak(`${resultProduct.name}. ${resultProduct.recalled ? '리콜 제품입니다.' :
            resultProduct.allergens.length > 0 ? `${resultProduct.allergens.join(', ')} 성분이 포함되어 있습니다.` :
            '안전한 상품입니다.'}`);
        } else {
          speak('결과 화면에서 사용해주세요.');
        }
        break;
      case '처음으로':
        navigateTo('scanner');
        speak('스캔 화면으로 이동합니다.');
        break;
      default:
        speak('인식할 수 없는 명령입니다.');
    }
  }, [navigateTo, prevScreen, screen, resultProduct, stopRecognition]);

  const startRecognition = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      showToast('이 브라우저에서는 음성 인식이 지원되지 않습니다.');
      return;
    }

    stopTTS();
    stopRecognition();

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'ko-KR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      setSttListening(true);
      setSttTranscript('');
    };

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }
      setSttTranscript(finalText || interimText);

      if (finalText) {
        const matched = matchCommand(finalText);
        if (matched) {
          handleVoiceCommand(matched);
        } else {
          speak(`"${finalText}" — 인식할 수 없는 명령입니다. 다시 시도해주세요.`);
          setSttListening(false);
        }
      }
    };

    recognition.onerror = (event) => {
      console.warn('STT error:', event.error);
      setSttListening(false);
      if (event.error === 'not-allowed') {
        showToast('마이크 권한이 필요합니다.');
      } else if (event.error === 'no-speech') {
        showToast('음성이 감지되지 않았습니다. 다시 시도하세요.');
      }
    };

    recognition.onend = () => {
      setSttListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [matchCommand, handleVoiceCommand, showToast, stopRecognition]);

  // FAB 탭 → 모달 열기 + 즉시 음성 인식 시작
  const toggleSTT = () => {
    // 오디오 unlock (모바일 대응)
    unlockAudio();

    if (sttOpen) {
      stopRecognition();
      setSttOpen(false);
      setSttTranscript('');
    } else {
      setSttOpen(true);
      setSttTranscript('');
      // 즉시 음성 인식 시작
      if (SpeechRecognitionAPI) {
        setTimeout(() => startRecognition(), 200);
      }
    }
  };

  // 로딩
  if (screen === 'loading') {
    return (
      <div className="app-container flex-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  // 온보딩
  if (screen === 'onboarding') {
    return (
      <div className="app-container">
        <div className="app-content" style={{ padding: 0 }}>
          <Onboarding onComplete={() => navigateTo('scanner')} />
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'scanner', label: '스캔', icon: ScanLine },
    { id: 'result', label: '결과', icon: ClipboardList },
    { id: 'settings', label: '설정', icon: Settings2 },
  ];

  return (
    <div className="app-container">
      <header className="app-header">
        <h1><Shield size={24} /> 알러지 가드</h1>
      </header>

      <main className="app-content">
        {screen === 'scanner' && <Scanner onResult={handleResult} />}
        {screen === 'result' && resultProduct && (
          <Result
            product={resultProduct}
            onBack={() => navigateTo('scanner')}
            onScanAgain={() => navigateTo('scanner')}
          />
        )}
        {screen === 'result' && !resultProduct && (
          <div className="flex-col gap-md text-center" style={{ paddingTop: 48 }}>
            <ClipboardList size={48} color="var(--text-muted)" style={{ margin: '0 auto' }} />
            <p className="text-muted">아직 스캔 결과가 없습니다.</p>
            <button className="btn btn-primary" onClick={() => navigateTo('scanner')}
              aria-label="스캔하러 가기" id="btn-go-scan">스캔하러 가기</button>
          </div>
        )}
        {screen === 'settings' && <SettingsScreen />}
      </main>

      {/* FAB: 마이크 — 탭하면 즉시 음성 인식 */}
      <button
        className={`fab ${sttOpen ? 'listening' : ''}`}
        onClick={toggleSTT}
        aria-label="음성 명령"
        id="fab-stt"
      >
        {sttListening ? <MicOff size={28} /> : <Mic size={28} />}
      </button>

      {/* 탭바 */}
      <nav className="tab-bar" role="tablist" aria-label="메인 내비게이션">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`tab-btn ${screen === id ? 'active' : ''}`}
            onClick={() => { unlockAudio(); navigateTo(id); }}
            role="tab"
            aria-selected={screen === id}
            aria-label={label}
            id={`tab-${id}`}
          >
            <Icon size={24} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* STT 모달 — 음성 인식 + 버튼 선택지 */}
      {sttOpen && (
        <div className="modal-backdrop" onClick={() => { stopRecognition(); setSttOpen(false); }}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>🎙️ 음성 명령</h3>

            {/* 음성 인식 상태 */}
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              {sttListening ? (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--danger-dim)',
                  border: '1px solid var(--danger)',
                  animation: 'fab-pulse 1.5s ease-in-out infinite',
                  marginBottom: 8,
                }}>
                  <p style={{ fontSize: 'var(--fs-base)', color: 'var(--danger)', fontWeight: 700 }}>
                    🔴 듣고 있습니다...
                  </p>
                </div>
              ) : SpeechRecognitionAPI ? (
                <button
                  className="btn btn-primary"
                  onClick={startRecognition}
                  id="btn-stt-retry"
                  style={{ width: 180, borderRadius: 999, gap: 8, marginBottom: 8 }}
                >
                  <Mic size={20} /> 다시 말하기
                </button>
              ) : null}

              {/* 인식된 텍스트 */}
              {sttTranscript && (
                <div style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--accent-dim)',
                  border: '1px solid var(--accent)',
                  marginBottom: 8,
                }}>
                  <p style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--accent)' }}>
                    "{sttTranscript}"
                  </p>
                </div>
              )}

              {!SpeechRecognitionAPI && (
                <p className="text-muted" style={{ fontSize: 'var(--fs-xs)' }}>
                  이 브라우저에서는 음성 인식이 지원되지 않습니다
                </p>
              )}
            </div>

            {/* 구분선 */}
            <div style={{ borderTop: '1px solid var(--border)', margin: '0 -16px 12px', padding: 0 }} />

            {/* 버튼 선택지 (항상 표시) */}
            <p className="text-muted mb-sm" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center' }}>
              또는 아래에서 직접 선택
            </p>
            <div className="stt-commands">
              {STT_COMMANDS.map(({ label, desc, command }) => (
                <button
                  key={command}
                  className="stt-cmd-btn"
                  onClick={() => handleVoiceCommand(command)}
                  aria-label={`${label} - ${desc}`}
                  id={`stt-${command}`}
                >
                  <span style={{ fontWeight: 700, color: 'var(--accent)', minWidth: 100 }}>{label}</span>
                  <span className="text-muted" style={{ fontSize: 'var(--fs-xs)' }}>{desc}</span>
                </button>
              ))}
            </div>
            <button
              className="btn btn-ghost mt-md"
              onClick={() => { stopRecognition(); setSttOpen(false); }}
              aria-label="닫기" id="btn-stt-close"
              style={{ fontSize: 'var(--fs-sm)' }}
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className="toast" role="status" aria-live="polite">
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
