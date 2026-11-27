import { useEffect, useRef, useState } from "react";
import { FrameLane, videoSource, type Frame, type VideoSource } from "./videoengine";

/** The engine's view of a video asset once it's open (null while opening, or where the browser can't decode it). */
export function useVideoSource(id: string | undefined): VideoSource | null {
  const [s, set] = useState<VideoSource | null>(null);
  useEffect(() => {
    let live = true;
    set(null);
    videoSource(id).then((v) => { if (live) set(v); });
    return () => { live = false; };
  }, [id]);
  return s;
}

/** Frames are decoded at most this big for the editor (the export decodes at full size). */
export const EDITOR_SIDE = 1280;

/**
 * The exact frame for `time` (seconds into the file), drawn on a canvas that sits over the video element.
 * While `active` is false it's hidden (the <video> element plays then, with its sound).
 */
export function ExactFrame({ src, time, active, className, style }: { src: VideoSource; time: number; active: boolean; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lane = useRef<FrameLane | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const draw = (f: Frame) => {
      const c = ref.current;
      if (!c) return;
      if (c.width !== f.w || c.height !== f.h) { c.width = f.w; c.height = f.h; }
      c.getContext("2d")!.drawImage(f.img, 0, 0);
      setShown(true);
    };
    lane.current = new FrameLane(src, EDITOR_SIDE, draw);
    return () => { lane.current?.stop(); lane.current = null; };
  }, [src]);
  useEffect(() => { if (active) lane.current?.request(time); }, [time, active, src]);
  useEffect(() => { if (!active) setShown(false); }, [active]);
  return <canvas ref={ref} className={className} style={{ ...style, visibility: active && shown ? "visible" : "hidden" }} />;
}
