import { useRef, useState, useCallback, useEffect } from 'react';
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';

// ================================================================
// 수정된 calcPosition - Y축 방향 수정
// ================================================================
function calcPosition(bx, by) {
  const dx = bx - 0.5;
  const dy = by - 0.5;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const proximity = Math.max(0, Math.min(1, 1 - dist * 2));

  const parts = [];
  // ✅ 수정: Y축 반전 수정 (dy < 0 = 화면 상단 = 위로 이동 필요)
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

  // ✅ 수정: proximity를 콜백으로 전달하기 위해 ref 유지하되
  //         onProximityChange 콜백을 별도로 받음
  const positionRef = useRef(null);

  const hasNative =
    typeof window !== 'undefined' && 'BarcodeDetector' in window;

  useEffect(() => {
    if (hasNative) {
      try {
        nativeDetectorRef.current = new window.BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e', 'code_128'],
        });
      } catch { /* 미지원 포맷 무시 */ }
    }
  }, [hasNative]);

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

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    // ✅ 수정: ZXing reset 처리
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

  // ✅ 수정: onProximityChange 콜백 추가 - 비프음 제어용
  const startScanning = useCallback(
    (onDetected, onSearching, onProximityChange) => {
      if (!videoRef.current) return;
      scanningRef.current = true;

      if (nativeDetectorRef.current && canvasRef.current) {
        // ── 방법 1: 네이티브 BarcodeDetector ──
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let lastScan = 0;
        let notFoundCount = 0;

        const loop = async (ts) => {
          if (!scanningRef.current) return;

          // ✅ 수정: 간격 100ms로 단축 → 비프음 변화 부드럽게
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

                  // ✅ 수정: proximity 콜백을 매 프레임 호출
                  onProximityChange?.(posInfo.proximity, posInfo.direction);

                  // 중앙 정렬됐을 때만 onDetected 호출
                  if (posInfo.proximity > 0.7) {
                    onDetected?.(bc.rawValue, posInfo);
                    return; // 스캔 성공 → 루프 종료
                  }
                } else {
                  notFoundCount++;
                  positionRef.current = null;

                  // ✅ 수정: 매 프레임 proximity 0으로 전달 → 비프음 소거
                  onProximityChange?.(0, null);

                  // 미감지 2초(20프레임)마다 onSearching
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
        // ── 방법 2: ZXing (BarcodeDetector 미지원 시) ──
        try {
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [
            BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
            BarcodeFormat.QR_CODE, BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E, BarcodeFormat.CODE_128,
          ]);
          hints.set(DecodeHintType.TRY_HARDER, true);

          const reader = new BrowserMultiFormatReader(hints);
          zxingReaderRef.current = reader;

          // ✅ 수정: decodeFromVideoElement → decodeFromStream 사용
          //         이미 열린 stream을 직접 전달 → 충돌 방지
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
                positionRef.current = null;
                onProximityChange?.(1, '가운데입니다. 유지하세요');
                onDetected?.(result.getText(), null);
              } else {
                // ZXing은 bounding box 없음 → proximity 0으로 고정
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
      }
    },
    []
  );

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
    hasNativeDetector: hasNative,
    startCamera,
    stopCamera,
    startScanning,
  };
}