import { useState, useEffect, useRef } from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, ArrowLeft, Volume2 } from 'lucide-react';
import { speak, stopTTS, playWarningSound, hapticWarning } from '../utils';

// ================================================================
// 결과 화면 - 상품 정보 + 알레르기 매칭
// ================================================================

export default function Result({ product, onBack, onScanAgain }) {
  const [showRecallOverlay, setShowRecallOverlay] = useState(false);

  // TTS 중복 방지 ref
  const announcedRef = useRef(false);
  const recallTimerRef = useRef(null);

  // 사용자 알레르기 (ref로 한 번만 계산)
  const userAllergens = useRef((() => {
    const raw = localStorage.getItem('allergy');
    if (!raw || raw === 'none') return [];
    try { return JSON.parse(raw); } catch { return []; }
  })()).current;

  // 알레르기 매칭
  const matchedAllergens = product.allergens.filter((a) => userAllergens.includes(a));
  const isDanger = matchedAllergens.length > 0;
  const isRecall = product.recalled;
  const isNotFound = product.notFound === true;
  const isSafe = !isDanger && !isRecall && !isNotFound;

  // 최초 마운트 시 1회만 TTS 발화
  useEffect(() => {
    if (announcedRef.current) return;
    announcedRef.current = true;

    stopTTS(); // Scanner에서 남은 TTS 정리

    // 약간의 딜레이 후 발화 (Scanner TTS와 겹침 방지)
    const timer = setTimeout(() => {
      if (isRecall) {
        playWarningSound();
        hapticWarning();
        speak('경고! 리콜 제품입니다. 즉시 사용을 중단하세요.');
        setShowRecallOverlay(true);
      } else if (isDanger) {
        playWarningSound();
        hapticWarning();
        speak(`주의! ${product.name}에 ${matchedAllergens.join(', ')} 성분이 포함되어 있습니다.`);
      } else if (isNotFound) {
        speak('데이터베이스에 등록되지 않은 상품입니다. 성분표를 직접 촬영해주세요.');
      } else {
        speak(`${product.name}은 안전한 상품입니다.`);
      }
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 빈 의존성: 마운트 시 1회만

  // 리콜 오버레이: 3회 반복 후 자동 닫기
  useEffect(() => {
    if (!showRecallOverlay) return;
    let count = 0;

    recallTimerRef.current = setInterval(() => {
      count++;
      if (count >= 3) {
        clearInterval(recallTimerRef.current);
        setTimeout(() => setShowRecallOverlay(false), 2000);
        return;
      }
      speak('리콜 제품입니다. 즉시 사용을 중단하세요.');
      hapticWarning();
    }, 3000);

    return () => {
      if (recallTimerRef.current) clearInterval(recallTimerRef.current);
    };
  }, [showRecallOverlay]);

  // 수동 재읽기
  const readResult = () => {
    stopTTS();
    if (isRecall) {
      speak('리콜 제품입니다. 즉시 사용을 중단하세요.');
    } else if (isDanger) {
      speak(`${product.name}에 ${matchedAllergens.join(', ')} 성분이 포함되어 있습니다.`);
    } else {
      speak(`${product.name}은 안전한 상품입니다.`);
    }
  };

  const statusLabel = isRecall ? '리콜 제품' : isDanger ? '알레르기 주의' : isNotFound ? '미등록 상품' : '안전';
  const StatusIcon = isRecall ? AlertTriangle : isDanger ? ShieldAlert : ShieldCheck;
  const statusColor = isRecall ? 'var(--danger)' : isDanger ? 'var(--danger)' : isNotFound ? 'var(--accent)' : 'var(--safe)';
  const cardClass = isRecall ? 'card card-recall' : isDanger ? 'card card-danger' : isNotFound ? 'card' : 'card card-safe';

  return (
    <>
      {/* 리콜 전체화면 오버레이 */}
      {showRecallOverlay && (
        <div className="recall-overlay" role="alert" aria-live="assertive">
          <AlertTriangle size={80} />
          <h2>⚠️ 리콜 제품</h2>
          <p>즉시 사용을 중단하세요!</p>
          <p style={{ fontSize: 'var(--fs-base)' }}>{product.recallInfo}</p>
          <button
            className="btn"
            onClick={() => setShowRecallOverlay(false)}
            aria-label="확인"
            id="btn-recall-dismiss"
            style={{ background: 'rgba(255,255,255,0.2)', maxWidth: 200 }}
          >
            확인
          </button>
        </div>
      )}

      <div className="flex-col gap-md">
        {/* 뒤로가기 */}
        <button
          className="btn btn-ghost"
          onClick={() => { stopTTS(); onBack(); }}
          aria-label="뒤로 가기"
          id="btn-result-back"
          style={{ justifyContent: 'flex-start', minHeight: 48, padding: '8px 0' }}
        >
          <ArrowLeft size={20} /> 뒤로
        </button>

        {/* 상태 아이콘 */}
        <div className={`result-icon ${isSafe ? 'safe' : 'danger'}`}>
          <StatusIcon size={40} />
        </div>

        <h2 className="text-center" style={{ fontSize: 'var(--fs-xl)', fontWeight: 700, color: statusColor }}>
          {statusLabel}
        </h2>

        {/* 상품 정보 카드 */}
        <div className={cardClass}>
          <h3 style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 12 }}>
            {product.name}
          </h3>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 4 }}>
            바코드: {product.barcode}
          </p>

          {/* 성분 목록 */}
          <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, marginTop: 16, marginBottom: 8 }}>
            성분 목록
          </p>
          <div className="ingredient-list">
            {product.ingredients.map((ing) => {
              const isMatch = matchedAllergens.some((a) =>
                ing.includes(a) || product.allergens.includes(ing.replace('가루', '').replace('버터', ''))
              );
              return (
                <span key={ing} className={`ingredient-tag ${isMatch ? 'match' : ''}`}>
                  {isMatch && '⚠️ '}{ing}
                </span>
              );
            })}
          </div>

          {/* 매칭된 알레르기 */}
          {isDanger && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 'var(--radius-xs)',
              background: 'var(--danger-dim)', border: '1px solid var(--danger)',
            }}>
              <p style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 'var(--fs-base)' }}>
                ⚠️ 알레르기 주의: {matchedAllergens.join(', ')}
              </p>
            </div>
          )}

          {/* 리콜 정보 */}
          {isRecall && (
            <div style={{
              marginTop: 16, padding: 12, borderRadius: 'var(--radius-xs)',
              background: 'var(--danger-dim)', border: '1px solid var(--danger)',
            }}>
              <p style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 'var(--fs-base)' }}>
                🚫 리콜 사유
              </p>
              <p style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-sm)', marginTop: 8 }}>
                {product.recallInfo}
              </p>
            </div>
          )}
        </div>

        {/* 하단 버튼 */}
        <button
          className="btn btn-outline mt-md"
          onClick={readResult}
          aria-label="결과 다시 읽기"
          id="btn-read-result"
        >
          <Volume2 size={20} /> 결과 다시 읽기
        </button>

        <button
          className="btn btn-primary"
          onClick={() => { stopTTS(); onScanAgain(); }}
          aria-label="다시 스캔하기"
          id="btn-scan-again"
        >
          다시 스캔하기
        </button>

        {/* 데이터 출처 */}
        {product.source && (
          <p className="text-muted mt-md" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center' }}>
            데이터 출처: {product.source}
          </p>
        )}

        {/* 미등록 상품 안내 */}
        {isNotFound && (
          <div className="card mt-md" style={{ borderColor: 'var(--accent)', background: 'var(--accent-dim)' }}>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--accent)', fontWeight: 600, textAlign: 'center' }}>
              💡 성분표 촬영(OCR) 기능으로<br />성분을 직접 분석할 수 있습니다.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
