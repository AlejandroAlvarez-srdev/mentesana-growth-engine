"use client";

const PURPLE = "#6A178C";

export type AdPreviewData = {
  fb_ad_id: string;
  ad_name?: string | null;
  campaign_name?: string | null;
  adset_name?: string | null;
  creative_thumbnail?: string | null;
  title?: string | null;
  body?: string | null;
  cta?: string | null;
  link_url?: string | null;
  preview_shareable_link?: string | null;
  spend?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  hook_rate?: number | null;
  video_avg_watch_sec?: number | null;
  results?: number | null;
};

export default function AdPreviewModal({ open, onClose, ad }: { open: boolean; onClose: () => void; ad: AdPreviewData | null }) {
  if (!open || !ad) return null;
  const adsManagerUrl = `https://business.facebook.com/adsmanager/manage/ads?selected_ad_ids=${ad.fb_ad_id}`;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, maxWidth: 720, width: "100%", maxHeight: "92vh", overflowY: "auto", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 24px 80px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "18px 20px 12px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ flex: 1, paddingRight: 12 }}>
            <div style={{ fontSize: 11, color: "#888", fontWeight: 600, marginBottom: 4 }}>{ad.campaign_name ?? "—"}{ad.adset_name ? ` · ${ad.adset_name}` : ""}</div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: "#1a1a2e", lineHeight: 1.25 }}>{ad.ad_name ?? "Anuncio"}</h2>
            <div style={{ fontSize: 11, color: "#aaa", fontFamily: "ui-monospace, monospace", marginTop: 4 }}>id {ad.fb_ad_id}</div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: "transparent", border: "none", fontSize: 22, color: "#888", cursor: "pointer", padding: 4, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 20, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}>
          {ad.creative_thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ad.creative_thumbnail} alt={ad.ad_name ?? "preview"} style={{ width: "100%", maxHeight: 360, objectFit: "cover", borderRadius: 12, background: "#f3f4f6", border: "1px solid rgba(0,0,0,0.05)" }} />
          ) : (
            <div style={{ width: "100%", height: 220, background: "#f3f4f6", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: 13 }}>Sin thumbnail</div>
          )}

          {(ad.title || ad.body || ad.cta || ad.link_url) && (
            <div style={{ background: "#FFFAF2", borderRadius: 12, padding: 16, border: `1px solid ${PURPLE}22` }}>
              {ad.title && <div style={{ fontSize: 15, fontWeight: 700, color: "#1a1a2e", marginBottom: 6 }}>{ad.title}</div>}
              {ad.body && <p style={{ margin: 0, fontSize: 13, color: "#1a1a2e", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{ad.body}</p>}
              {(ad.cta || ad.link_url) && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                  {ad.cta && <span style={{ padding: "6px 12px", background: PURPLE, color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 0.3 }}>{ad.cta}</span>}
                  {ad.link_url && <a href={ad.link_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: PURPLE, textDecoration: "none", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ad.link_url} ↗</a>}
                </div>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <Metric label="Spend" value={ad.spend != null ? `${ad.spend.toFixed(0)}€` : "—"} />
            <Metric label="Impresiones" value={ad.impressions != null ? ad.impressions.toLocaleString("es-ES") : "—"} />
            <Metric label="CTR" value={ad.ctr != null ? `${ad.ctr.toFixed(2)}%` : "—"} />
            <Metric label="Hook Rate" value={ad.hook_rate != null ? `${ad.hook_rate.toFixed(1)}%` : "—"} highlight={ad.hook_rate != null && ad.hook_rate >= 25} />
            <Metric label="AVG Watch" value={ad.video_avg_watch_sec != null ? `${ad.video_avg_watch_sec.toFixed(1)}s` : "—"} />
            <Metric label="Resultados" value={ad.results != null ? String(ad.results) : "—"} />
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href={adsManagerUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", background: PURPLE, color: "#fff", borderRadius: 999, fontSize: 12, fontWeight: 700, textDecoration: "none" }}>↗ Abrir en Meta Ads Manager</a>
            {ad.preview_shareable_link && <a href={ad.preview_shareable_link} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 16px", background: "#fff", color: PURPLE, border: `1.5px solid ${PURPLE}55`, borderRadius: 999, fontSize: 12, fontWeight: 700, textDecoration: "none" }}>🔗 Preview shareable</a>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ padding: 10, background: highlight ? "rgba(16,163,74,0.08)" : "#fff", border: `1px solid ${highlight ? "rgba(16,163,74,0.25)" : "rgba(0,0,0,0.06)"}`, borderRadius: 8, textAlign: "center" }}>
      <div style={{ fontSize: 9.5, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: highlight ? "#065f46" : "#1a1a2e" }}>{value}</div>
    </div>
  );
}
