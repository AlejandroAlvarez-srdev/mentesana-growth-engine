"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { track } from "@/lib/tracking";

export default function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    track("page_view", { path: pathname, query: searchParams?.toString() || "" });
  }, [pathname, searchParams]);

  return null;
}
