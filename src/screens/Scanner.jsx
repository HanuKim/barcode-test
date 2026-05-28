import { useState, useEffect, useRef, useCallback } from 'react';
import { ScanLine, Camera, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Crosshair } from 'lucide-react';
import useBarcodeScanner from '../hooks/useBarcodeScanner';
import { speak, stopTTS, playBeep, playSuccessSound, hapticImpact, hapticSuccess, unlockAudio } from '../utils';
import { fetchProduct } from '../services/productService';

// ================================================================
// 바코드 스캔 화면 — 위치 기반 비프음 + 방향 TTS 가이드
// ================================================================

function DirectionIcon({ dx, dy }) {
  if (!dx && !dy) return <ScanLine size={32} />;
  if (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12) return <Crosshair size={32} />;
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? <ArrowUp size={32} /> : <ArrowDown size={32} />;
  return dx > 0 ? <ArrowLeft size={32} /> : <ArrowRight size={32} />;
}

export default function Scanner({ onResult }) {
  const scanner = useBarcodeScanner();
  const [phase, setPhase] = useState('idle');
  const [foundBarcode, setFoundBarcode] = useState(null);
  const [directionText, setDirectionText] = useState('');
  const [directionPos, setDirectionPos] = useState(null);

  // 타이머/오디오 refs
  const beepTimerRef = useRef(null);
  const phaseRef = useRef('idle');
  const detectedRef = useRef(false);
  const lastTtsDirectionRef = useRef('');
  const lastTtsTimeRef = useRef(0);
  const lastBeepProximityRef = useRef(-1);
  phaseRef.current = phase;

  // ── 비프음 관리 ──
  const startBeep = useCallback((proximity) => {
    // 근접도 변화가 미미하면 비프 타이머를 재생성하지 않음
    if (Math.abs(proximity - lastBeepProximityRef.current) < 0.08 && beepTimerRef.current) return;
    lastBeepProximityRef.current = proximity;

    if (beepTimerRef.current) clearInterval(beepTimerRef.current);

    if (proximity <= 0) {
      // 미감지: 낮은 톤, 느린 간격
      beepTimerRef.current = setInterval(() => {
        if (phaseRef.current === 'scanning') playBeep(400, 50, 0.1);
      }, 1200);
    } else {
      // 감지됨: 근접도에 비례하여 빠르고 높은 비프
      const freq = 500 + proximity * 700;       // 500Hz ~ 1200Hz
      const vol = 0.15 + proximity * 0.25;       // 0.15 ~ 0.40
      const interval = Math.max(100, 900 - proximity * 800); // 900ms ~ 100ms
      beepTimerRef.current = setInterval(() => {
        if (phaseRef.current === 'scanning') playBeep(freq, 60, vol);
      }, interval);
    }
  }, []);

  const cleanup = useCallback(() => {
    if (beepTimerRef.current) { clearInterval(beepTimerRef.current); beepTimerRef.current = null; }
    lastBeepProximityRef.current = -1;
    lastTtsDirectionRef.current = '';
    detectedRef.current = false;
    stopTTS();
  }, []);

  useEffect(() => () => { cleanup(); scanner.stopCamera(); }, [cleanup, scanner.stopCamera]);

  // ── 스캔 시작 ──
  const handleStartScan = async () => {
    unlockAudio(); // 모바일 AudioContext unlock (사용자 터치 이벤트 내에서 호출)
    setPhase('scanning');
    setFoundBarcode(null);
    setDirectionText('카메라 준비 중...');
    setDirectionPos(null);
    detectedRef.current = false;
    await scanner.startCamera();
  };

  // ── 카메라 준비 → 감지 루프 ──
  useEffect(() => {
    if (!scanner.cameraReady || phase !== 'scanning') return;

    speak('카메라가 켜졌습니다. 바코드를 향해 카메라를 이동해주세요.');
    startBeep(0); // 탐색 비프 시작

    scanner.startScanning(
      // ── onDetected ──
      async (rawValue, posInfo) => {
        if (detectedRef.current) return;
        detectedRef.current = true;

        cleanup();
        scanner.stopCamera();
        setPhase('found');
        setFoundBarcode(rawValue);
        setDirectionText('');

        playSuccessSound();
        hapticSuccess();
        stopTTS();

        const product = await fetchProduct(rawValue);
        if (!product.found) {
          onResult({
            name: `미등록 상품 (${rawValue})`,
            barcode: rawValue,
            ingredients: ['등록되지 않은 상품입니다. 성분표를 직접 촬영해주세요.'],
            allergens: [],
            recalled: false,
            notFound: true,
          });
        } else {
          onResult(product);
        }
      },
      // ── onSearching ──
      () => {
        if (phaseRef.current !== 'scanning') return;
        setDirectionText('바코드를 찾고 있습니다...');
        setDirectionPos(null);
      },
      // ── onProximityChange (매 프레임) ──
      (proximity, direction) => {
        if (phaseRef.current !== 'scanning' || detectedRef.current) return;

        // 1) 비프음 실시간 조절
        startBeep(proximity);

        // 2) UI 업데이트
        if (direction) {
          setDirectionText(direction);
          setDirectionPos(scanner.positionRef.current);
        } else {
          setDirectionPos(null);
        }

        // 3) 방향 TTS — 2초마다 (동일 방향이어도 계속 안내)
        const now = Date.now();
        if (direction && now - lastTtsTimeRef.current > 2000) {
          lastTtsDirectionRef.current = direction;
          lastTtsTimeRef.current = now;
          stopTTS();
          speak(direction, 1.3); // 빠르게 발화
        }
      }
    );

    return () => { cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanner.cameraReady]);

  // ── 성분표 OCR ──
  const handleOCR = async () => {
    setPhase('ocr');
    speak('성분표 촬영을 준비합니다.');
    await scanner.startCamera();
  };

  const captureOCR = useCallback(() => {
    if (!scanner.videoRef.current || !scanner.canvasRef.current) return;
    const v = scanner.videoRef.current;
    const c = scanner.canvasRef.current;
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    scanner.stopCamera();
    speak('성분표를 분석합니다. 잠시 기다려주세요.');
    setTimeout(() => {
      onResult({
        name: 'OCR 인식 상품', barcode: 'OCR-SCAN',
        ingredients: ['밀가루', '설탕', '땅콩버터', '팜유', '대두유', '소금'],
        allergens: ['밀', '땅콩', '대두'], recalled: false,
      });
    }, 1500);
  }, [scanner, onResult]);

  const handleCancel = () => {
    cleanup();
    scanner.stopCamera();
    setPhase('idle');
  };

  // ── 카메라 에러 ──
  if (scanner.error) {
    return (
      <div className="flex-col gap-md">
        <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Camera size={28} color="var(--danger)" /> 카메라 오류
        </h2>
        <div className="card card-danger"><p>{scanner.error}</p></div>
        <button className="btn btn-primary" onClick={() => setPhase('idle')}
          aria-label="돌아가기" id="btn-back-from-error">돌아가기</button>
      </div>
    );
  }

  // ── 근접도 바 ──
  const proximityPercent = directionPos ? Math.round(directionPos.proximity * 100) : 0;

  return (
    <div className="flex-col gap-md">
      <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ScanLine size={28} color="var(--accent)" />
        {phase === 'ocr' ? '성분표 촬영' : '바코드 스캔'}
      </h2>

      {/* 카메라 뷰포트 */}
      <div className="scanner-viewport">
        <video ref={scanner.videoRef} playsInline muted style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
          display: (phase === 'scanning' || phase === 'ocr') ? 'block' : 'none',
        }} />
        <canvas ref={scanner.canvasRef} style={{ display: 'none' }} />
        <div className="scanner-grid" />

        {/* 🔧 디버그 오버레이 — 실시간 바코드 좌표/근접도 표시 */}
        {scanner.debugInfo && (phase === 'scanning') && (
          <div style={{
            position: 'absolute', top: 8, left: 8, right: 8, zIndex: 30,
            background: 'rgba(0,0,0,0.75)', borderRadius: 8, padding: '8px 10px',
            fontSize: 11, fontFamily: 'monospace', color: '#0ff', lineHeight: 1.6,
            pointerEvents: 'none',
          }}>
            <div>📡 모드: <b style={{color:'#ff0'}}>{scanner.debugInfo.mode ?? '초기화 중...'}</b></div>
            {scanner.debugInfo.rawValue
              ? <>
                  <div>🔲 바코드: <b style={{color:'#0f0'}}>{scanner.debugInfo.rawValue}</b></div>
                  <div>📍 중심(정규화): bx={scanner.debugInfo.bx} by={scanner.debugInfo.by}</div>
                  <div>📐 BBox: {scanner.debugInfo.bb}</div>
                  <div>🎯 근접도: <b style={{color: parseFloat(scanner.debugInfo.proximity) > 0.7 ? '#0f0' : '#ff0'}}>{Math.round(parseFloat(scanner.debugInfo.proximity)*100)}%</b></div>
                  <div>🧭 방향: {scanner.debugInfo.direction}</div>
                </>
              : <div style={{color:'#888'}}>바코드 미감지</div>
            }
          </div>
        )}

        {phase === 'scanning' && (
          <>
            <div className="scan-line" />
            {/* 바운딩 박스 */}
            {directionPos?.boundingBox && (() => {
              const { boundingBox: bb, frameW, frameH } = directionPos;
              return (
                <div style={{
                  position: 'absolute', zIndex: 10, transition: 'all 0.15s ease',
                  left: `${(bb.x / frameW) * 100}%`, top: `${(bb.y / frameH) * 100}%`,
                  width: `${(bb.width / frameW) * 100}%`, height: `${(bb.height / frameH) * 100}%`,
                  border: `3px solid ${directionPos.proximity > 0.7 ? 'var(--safe)' : 'var(--accent)'}`,
                  borderRadius: 4,
                  boxShadow: `0 0 ${directionPos.proximity > 0.7 ? 30 : 15}px rgba(${directionPos.proximity > 0.7 ? '0,255,100' : '255,215,0'},0.5)`,
                }} />
              );
            })()}
            {/* 방향 가이드 */}
            <div className="direction-overlay">
              <div className="direction-arrow">
                <DirectionIcon dx={directionPos?.dx} dy={directionPos?.dy} />
              </div>
              <span>{directionText}</span>
            </div>
          </>
        )}

        {phase === 'idle' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 5, background: 'rgba(0,0,0,0.6)',
          }}>
            <div style={{ textAlign: 'center', padding: 16 }}>
              <Camera size={48} color="var(--text-muted)" style={{ marginBottom: 8 }} />
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}>
                스캔 버튼을 눌러<br />바코드를 인식하세요
              </p>
            </div>
          </div>
        )}

        {phase === 'ocr' && scanner.cameraReady && (
          <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
            <button className="btn btn-primary" onClick={captureOCR}
              aria-label="촬영" id="btn-capture-ocr" style={{ width: 160, borderRadius: 999 }}>
              📸 촬영하기
            </button>
          </div>
        )}
      </div>

      {/* 상태 인디케이터 + 근접도 바 */}
      {phase === 'scanning' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 'var(--radius-xs)',
            background: directionPos ? 'var(--accent-dim)' : 'var(--bg-card)',
            border: `1px solid ${directionPos ? 'var(--accent)' : 'var(--border)'}`,
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%',
              background: directionPos
                ? (directionPos.proximity > 0.7 ? 'var(--safe)' : 'var(--accent)')
                : 'var(--text-muted)',
              animation: 'fab-pulse 1.5s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, flex: 1 }}>
              {directionPos ? '바코드 감지됨' : '탐색 중...'}
            </span>
            {directionPos && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                {proximityPercent}%
              </span>
            )}
          </div>
          {/* 근접도 프로그레스 바 */}
          {directionPos && (
            <div style={{
              height: 6, borderRadius: 3, background: 'var(--bg-card)',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 3,
                width: `${proximityPercent}%`,
                background: proximityPercent > 70
                  ? 'var(--safe)'
                  : `linear-gradient(90deg, var(--accent), ${proximityPercent > 40 ? '#FFA500' : 'var(--danger)'})`,
                transition: 'width 0.2s ease, background 0.3s ease',
              }} />
            </div>
          )}
        </div>
      )}

      {/* 버튼 */}
      {phase === 'idle' && (
        <div className="flex-col gap-sm">
          <button className="btn btn-primary" onClick={handleStartScan}
            aria-label="바코드 스캔 시작" id="btn-scan-start">
            <ScanLine size={24} /> 바코드 스캔 시작
          </button>
          <button className="btn ocr-btn" onClick={handleOCR}
            aria-label="성분표 촬영" id="btn-ocr">
            <Camera size={24} /> 성분표 촬영 (OCR)
          </button>
        </div>
      )}

      {(phase === 'scanning' || phase === 'ocr') && (
        <button className="btn btn-ghost" onClick={handleCancel}
          aria-label="취소" id="btn-cancel" style={{ fontSize: 'var(--fs-sm)' }}>
          취소
        </button>
      )}

      {phase === 'found' && (
        <div className="card card-safe text-center">
          <p style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--safe)' }}>✅ 인식 완료</p>
          <p className="text-accent mt-sm" style={{ fontSize: 'var(--fs-xl)', fontWeight: 800 }}>{foundBarcode}</p>
          <div className="loading-spinner" style={{ marginTop: 12 }} />
        </div>
      )}
    </div>
  );
}
