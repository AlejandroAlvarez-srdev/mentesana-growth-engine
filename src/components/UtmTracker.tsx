"use client";

import { useEffect } from "react";
import { captureUtms } from "@/lib/utm";

export default function UtmTracker() {
  useEffect(() => {
    captureUtms();
  }, []);
  return null;
}
