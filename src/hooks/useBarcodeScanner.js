import { useRef, useState, useCallback, useEffect } from 'react';
// [LEGACY] 기존 ZXing 라이브러리 — 동적 import로 폴백 사용
// import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';

// ================================================================
// 방향/근접도 계산 — Y축 방향 수정 포함
// ================================================================
function calcPosition(bx, by) {
  const dx = bx - 0.5;
  const dy = by - 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const proximity = Math.max(0, Math.min(1, 1 - dist * 2));

  const parts = [];
  // ✅ Y축 반전 수정 (dy < 0 = 화면 상단 = 위쪽으로 이동 필요)
  if (dy < -0.12) parts.push('위쪽');
  else if (dy > 0.12) parts.push('아래쪽');
  if (dx < -0.12) parts.push('왼쪽');
  else if (dx > 0.12) parts.push('오른쪽');

  const direction =
    parts.length > 0
      ? `${parts.join(', ')}으로 이동하세요`
      : '가운데입니다. 유지하세요';

  return { direction, proximity, dx, dy };
}

export default function useBarcodeScanner() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const nativeDetectorRef = useRef(null);
  const scanningRef = useRef(false);
  const zxingReaderRef = useRef(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState(null);
  // 디버그 오버레이용 상태
  const [debugInfo, setDebugInfo] = useState(null);

  // proximity를 콜백으로 전달하기 위해 ref 유지
  const positionRef = useRef(null);

  // BarcodeDetector API 지원 여부 (iOS WKWebView는 미지원)
  const hasNativeDetector =
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window;

  useEffect(() => {
    if (hasNativeDetector) {
      try {
        nativeDetectorRef.current = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e', 'code_128'],
        });
        setDebugInfo(info => ({ ...info, mode: 'BarcodeDetector (Web API)' }));
      } catch { /* 미지원 포맷 무시 */ }
    } else {
      setDebugInfo(info => ({ ...info, mode: 'ZXing (Fallback)' }));
    }
  }, [hasNativeDetector]);

  // ================================================================
  // 카메라 시작 — 항상 getUserMedia 사용 (네이티브/웹 동일)
  // ================================================================
  const startCamera = useCallback(async () => {
    setError(null);
    setCameraReady(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (err) {
      setError(
        err.name === 'NotAllowedError'
          ? '카메라 권한이 필요합니다. 설정에서 허용해주세요.'
          : '카메라를 사용할 수 없습니다.'
      );
    }
  }, []);

  // ================================================================
  // 카메라 정지
  // ================================================================
  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (zxingReaderRef.current) {
      try { zxingReaderRef.current.reset(); } catch { /* ignore */ }
      zxingReaderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
    positionRef.current = null;
  }, []);

  // ================================================================
  // 스캔 시작 — BarcodeDetector API / ZXing 폴백
  // ================================================================
  const startScanning = useCallback(
    (onDetected, onSearching, onProximityChange) => {
      if (!videoRef.current) return;
      scanningRef.current = true;

      // ────────────────────────────────────────────
      // 방법 A: BarcodeDetector API (Chrome, Safari, WKWebView 지원)
      // ────────────────────────────────────────────
      if (nativeDetectorRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let lastScan = 0;
        let notFoundCount = 0;

        const loop = async (ts) => {
          if (!scanningRef.current) return;

          if (ts - lastScan >= 100 && video.readyState >= 2) {
            lastScan = ts;
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            if (vw && vh) {
              canvas.width = vw;
              canvas.height = vh;
              ctx.drawImage(video, 0, 0, vw, vh);

              try {
                const barcodes = await nativeDetectorRef.current.detect(canvas);

                if (barcodes.length > 0) {
                  const bc = barcodes[0];
                  const bx = (bc.boundingBox.x + bc.boundingBox.width / 2) / vw;
                  const by = (bc.boundingBox.y + bc.boundingBox.height / 2) / vh;
                  const posInfo = {
                    ...calcPosition(bx, by),
                    boundingBox: bc.boundingBox,
                    frameW: vw,
                    frameH: vh,
                  };
                  positionRef.current = posInfo;
                  notFoundCount = 0;

                  // 디버그 정보 업데이트
                  setDebugInfo({
                    mode: 'BarcodeDetector (Web API)',
                    rawValue: bc.rawValue,
                    bx: bx.toFixed(3),
                    by: by.toFixed(3),
                    proximity: posInfo.proximity.toFixed(2),
                    direction: posInfo.direction,
                    frameW: vw,
                    frameH: vh,
                    bb: bc.boundingBox ? `${Math.round(bc.boundingBox.x)},${Math.round(bc.boundingBox.y)} ${Math.round(bc.boundingBox.width)}x${Math.round(bc.boundingBox.height)}` : '-',
                  });

                  onProximityChange?.(posInfo.proximity, posInfo.direction);

                  // 중앙 정렬됐을 때만 onDetected 호출
                  if (posInfo.proximity > 0.7) {
                    onDetected?.(bc.rawValue, posInfo);
                    return; // 스캔 성공 → 루프 종료
                  }
                } else {
                  notFoundCount++;
                  positionRef.current = null;
                  onProximityChange?.(0, null);
                  setDebugInfo(info => ({ ...info, rawValue: null, proximity: '0', direction: null, bb: null }));

                  if (notFoundCount % 20 === 0) {
                    onSearching?.();
                  }
                }
              } catch { /* ignore */ }
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);

      } else {
        // ────────────────────────────────────────────
        // 방법 B: ZXing 폴백 (BarcodeDetector 미지원 시)
        // @zxing/library 동적 import
        // ────────────────────────────────────────────
        (async () => {
          try {
            const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } =
              await import('@zxing/library');

            const hints = new Map();
            hints.set(DecodeHintType.POSSIBLE_FORMATS, [
              BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
              BarcodeFormat.QR_CODE, BarcodeFormat.UPC_A,
              BarcodeFormat.UPC_E, BarcodeFormat.CODE_128,
            ]);
            hints.set(DecodeHintType.TRY_HARDER, true);

            const reader = new BrowserMultiFormatReader(hints);
            zxingReaderRef.current = reader;

            if (!streamRef.current) {
              setError('카메라 스트림이 없습니다.');
              return;
            }

            reader.decodeFromStream(
              streamRef.current,
              videoRef.current,
              (result, err) => {
                if (!scanningRef.current) return;

                if (result) {
                  const text = result.getText();
                  const points = result.getResultPoints?.() ?? [];
                  const video = videoRef.current;
                  const vw = video?.videoWidth || window.innerWidth;
                  const vh = video?.videoHeight || window.innerHeight;

                  let posInfo = null;

                  if (points.length >= 2) {
                    // ZXing ResultPoint: .getX(), .getY() (픽셀 단위)
                    const xs = points.map(p => p.getX());
                    const ys = points.map(p => p.getY());
                    const minX = Math.min(...xs), maxX = Math.max(...xs);
                    const minY = Math.min(...ys), maxY = Math.max(...ys);
                    const cx = (minX + maxX) / 2;
                    const cy = (minY + maxY) / 2;
                    const bx = cx / vw;
                    const by = cy / vh;
                    posInfo = {
                      ...calcPosition(bx, by),
                      boundingBox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
                      frameW: vw,
                      frameH: vh,
                    };

                    // 디버그 콘솔 출력
                    console.log(`[ZXing] 바코드 인식:`, {
                      rawValue: text,
                      bx: bx.toFixed(3),
                      by: by.toFixed(3),
                      proximity: posInfo.proximity.toFixed(2),
                      direction: posInfo.direction,
                      boundingBox: `(${Math.round(minX)},${Math.round(minY)}) ${Math.round(maxX-minX)}x${Math.round(maxY-minY)}`,
                      points: points.map(p => `(${Math.round(p.getX())},${Math.round(p.getY())})`).join(' '),
                      frameSize: `${vw}x${vh}`,
                    });

                    // 디버그 오버레이 업데이트
                    setDebugInfo({
                      mode: 'ZXing (Fallback)',
                      rawValue: text,
                      bx: bx.toFixed(3),
                      by: by.toFixed(3),
                      proximity: posInfo.proximity.toFixed(2),
                      direction: posInfo.direction,
                      frameW: vw,
                      frameH: vh,
                      bb: `(${Math.round(minX)},${Math.round(minY)}) ${Math.round(maxX-minX)}x${Math.round(maxY-minY)}`,
                    });

                    positionRef.current = posInfo;
                    onProximityChange?.(posInfo.proximity, posInfo.direction);

                    // 중앙 정렬 시 인식 완료
                    if (posInfo.proximity > 0.7) {
                      scanningRef.current = false;
                      onDetected?.(text, posInfo);
                    }
                  } else {
                    // 좌표 없이 즉시 인식 완료 (포인트 정보 없는 경우)
                    console.log(`[ZXing] 바코드 인식 (좌표 없음):`, { rawValue: text });
                    setDebugInfo(info => ({ ...info, mode: 'ZXing (Fallback)', rawValue: text, proximity: '1', direction: '인식 완료' }));
                    positionRef.current = null;
                    onProximityChange?.(1, '가운데입니다. 유지하세요');
                    onDetected?.(text, null);
                  }
                } else {
                  // 미감지
                  setDebugInfo(info => ({ ...info, rawValue: null, proximity: '0', direction: null, bb: null }));
                  onProximityChange?.(0, null);
                }
              }
            );

            // ZXing 환경에서 "탐색 중" 주기 알림
            const searchTimer = setInterval(() => {
              if (!scanningRef.current) {
                clearInterval(searchTimer);
                return;
              }
              onSearching?.();
            }, 3000);
          } catch (e) {
            console.error('ZXing init error:', e);
            setError('바코드 스캐너를 초기화할 수 없습니다.');
          }
        })();
      }
    },
    []
  );

  // 클린업
  useEffect(() => {
    return () => {
      scanningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (zxingReaderRef.current) {
        try { zxingReaderRef.current.reset(); } catch { }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    cameraReady,
    error,
    positionRef,
    hasNativeDetector,
    debugInfo,
    startCamera,
    stopCamera,
    startScanning,
  };
}