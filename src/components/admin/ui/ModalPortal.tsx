"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

interface Props {
  children: React.ReactNode;
  onClose?: () => void;
}

const emptySubscribe = () => () => {};

/**
 * Renders modal content directly into document.body using a React Portal.
 * This guarantees that `position: fixed` is relative to the viewport, never
 * trapped inside `<main>` or affected by CSS transforms, overflow, or z-index stacking.
 * Also locks body scroll while open and handles the Escape key.
 */
export default function ModalPortal({ children, onClose }: Props) {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!isClient) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isClient, onClose]);

  if (!isClient || typeof document === "undefined") return null;

  return createPortal(children, document.body);
}
