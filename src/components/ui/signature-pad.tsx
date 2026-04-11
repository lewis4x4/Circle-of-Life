"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, PenTool } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SignaturePadProps {
  /** Callback when signature data changes (base64 string or null) */
  onSignatureChange?: (signatureData: string | null) => void;
  /** Initial signature data (base64) to restore */
  initialValue?: string | null;
  /** Height of the canvas in pixels */
  height?: number;
  /** Width percentage (default 100%) */
  width?: string;
  /** Disable the pad */
  disabled?: boolean;
  /** Custom className for the container */
  className?: string;
}

export function useSignaturePad() {
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);

  const clear = useCallback(() => {
    setHasSignature(false);
    setSignatureData(null);
  }, []);

  return { isDrawing, hasSignature, signatureData, setSignatureData, clear };
}

export function SignaturePad({
  onSignatureChange,
  initialValue = null,
  height = 200,
  width = "100%",
  disabled = false,
  className,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(!!initialValue);

  const getCoordinates = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }, []);

  const startDrawing = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    event.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    setIsDrawing(true);
    setHasSignature(true);

    const { x, y } = getCoordinates(event);
    ctx.beginPath();
    ctx.moveTo(x, y);

    // Set up drawing style
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, [disabled, getCoordinates]);

  const draw = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || disabled) return;
    event.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const { x, y } = getCoordinates(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }, [isDrawing, disabled, getCoordinates]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const canvas = canvasRef.current;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL("image/png");
    onSignatureChange?.(dataUrl);
  }, [isDrawing, onSignatureChange]);

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onSignatureChange?.(null);
  }, [onSignatureChange]);

  // Set up canvas size on mount and resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set internal resolution
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;

    // Scale context for high DPI
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    // Restore initial value if provided
    if (initialValue) {
      const img = new Image();
      img.onload = () => {
        ctx?.drawImage(img, 0, 0, rect.width, height);
      };
      img.src = initialValue;
    }
  }, [height, initialValue]);

  return (
    <div className={cn("space-y-3", className)}>
      <div
        className={cn(
          "relative border-2 border-dashed rounded-2xl overflow-hidden bg-white dark:bg-slate-950 transition-colors",
          isDrawing
            ? "border-slate-900 dark:border-slate-200"
            : "border-slate-200 dark:border-slate-700"
        )}
      >
        <canvas
          ref={canvasRef}
          height={height}
          width={width}
          className="block w-full touch-none"
          style={{ height: `${height}px` }}
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerLeave={stopDrawing}
        />
        {!hasSignature && !isDrawing && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <PenTool className="w-8 h-8" />
              <span className="text-sm font-medium">Sign above</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Draw your signature with mouse or touch
        </span>
        {hasSignature && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearSignature}
            className="h-8 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
            disabled={disabled}
          >
            <Eraser className="w-3.5 h-3.5 mr-1.5" />
            Clear Signature
          </Button>
        )}
      </div>
    </div>
  );
}
