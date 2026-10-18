"use client";

import { useRef, useState } from "react";
import { compressImage, type CompressedImage } from "@/lib/admin/imageCompress";
import { REIMBURSEMENT_STAGE_AR, validateReimbursement, type Policy2026Config, type ReimbursementStage, type ReimbursementType } from "@/lib/admin/hrPolicy2026";
import { s, ar, cx, money, Icon, LAB_ICONS, Panel } from "./ui";

type Kind = "ride_screenshot" | "quote" | "invoice";

const CHECKS: Record<ReimbursementType, { key: string; ar: string }[]> = {
  outdoor: [
    { key: "route", ar: "خط السير ظاهر على الخريطة" },
    { key: "endpoints", ar: "نقطة البداية والنهاية ظاهرة" },
    { key: "price", ar: "السعر النهائي ظاهر" },
  ],
  purchase: [
    { key: "quote", ar: "عرض سعر / رابط واضح قبل الشراء" },
    { key: "approved", ar: "موافقة إدارية مسبقة على المبلغ" },
    { key: "match", ar: "الفاتورة مطابقة للموافقة" },
  ],
};

const FLOW: Record<ReimbursementType, ReimbursementStage[]> = {
  outdoor: ["review", "approved"],
  purchase: ["pre_approval", "pending_invoice", "review", "approved"],
};

export default function ReimbursementLab({ cfg }: { cfg: Policy2026Config }) {
  const [type, setType] = useState<ReimbursementType>("outdoor");
  const [stage, setStage] = useState<ReimbursementStage | null>(null);
  const [from, setFrom] = useState("مقر الشركة — التجمع الخامس");
  const [to, setTo] = useState("موقع العميل — الشيخ زايد");
  const [amount, setAmount] = useState(185);
  const [approvedAmount, setApprovedAmount] = useState<number | null>(null);
  const [invoiceAmount, setInvoiceAmount] = useState(0);
  const [quoteLink, setQuoteLink] = useState("");
  const [files, setFiles] = useState<Partial<Record<Kind, CompressedImage>>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Kind | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const inputs = useRef<Partial<Record<Kind, HTMLInputElement | null>>>({});

  const kinds = Object.keys(files) as Kind[];
  const hashes = kinds.map((k) => files[k]!.sha256);
  const flags = validateReimbursement(
    { type, stage: stage ?? (type === "outdoor" ? "review" : "pre_approval"), amount, routeFrom: from, routeTo: to, quoteLink, approvedAmount, invoiceAmount, attachmentKinds: kinds, imageHashes: hashes },
    { knownHashes: history, cfg },
  );

  const upload = async (kind: Kind, file?: File | null) => {
    if (!file) return;
    setErr(null);
    setBusy(kind);
    try {
      const c = await compressImage(file);
      setFiles((f) => ({ ...f, [kind]: c }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "فشل الضغط");
    } finally {
      setBusy(null);
    }
  };

  const switchType = (t: ReimbursementType) => {
    setType(t);
    setStage(null);
    setFiles({});
    setChecks({});
    setApprovedAmount(null);
    setInvoiceAmount(0);
    setAmount(t === "outdoor" ? 185 : 1450);
  };

  const submit = () => setStage(type === "outdoor" ? "review" : "pre_approval");
  const advance = () => {
    if (!stage) return;
    if (stage === "pre_approval") {
      setApprovedAmount(amount);
      setStage("pending_invoice");
    } else if (stage === "pending_invoice") setStage("review");
    else if (stage === "review") {
      setStage("approved");
      setHistory((h) => [...h, ...hashes]);
    }
  };
  const reject = () => setStage("rejected");
  const restart = () => {
    setStage(null);
    setFiles({});
    setChecks({});
    setApprovedAmount(null);
    setInvoiceAmount(0);
  };

  const errors = flags.filter((f) => f.severity === "error");
  const flow = FLOW[type];
  const idx = stage ? flow.indexOf(stage) : -1;
  const requiredChecks = type === "purchase" && stage === "pre_approval" ? ["quote"] : CHECKS[type].map((c) => c.key);
  const canAdvance =
    stage === "pending_invoice" ? !!files.invoice && invoiceAmount > 0 : errors.length === 0 && requiredChecks.every((k) => checks[k]);

  const slot = (kind: Kind, label: string, hint: string) => {
    const f = files[kind];
    return (
      <div>
        <p className={s.label}>{label}</p>
        <input
          ref={(el) => {
            inputs.current[kind] = el;
          }}
          id={`lab-reimb-file-${kind}`}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void upload(kind, e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {f ? (
          <div style={{ position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.dataUrl} alt={label} className={s.thumb} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }} className={s.small}>
              <span className={s.mono} dir="ltr">
                {Math.round(f.originalBytes / 1024)}KB → <b style={{ color: "#6ee7b7" }}>{Math.round(f.bytes / 1024)}KB</b> · {f.width}×{f.height} · q{f.quality}
              </span>
              <button type="button" className={s.btnGhost} style={{ padding: "3px 8px", fontSize: 12 }} onClick={() => inputs.current[kind]?.click()} id={`lab-reimb-replace-${kind}`}>
                استبدال
              </button>
            </div>
          </div>
        ) : (
          <button type="button" id={`lab-reimb-drop-${kind}`} className={cx(s.drop, busy === kind && s.dropActive)} style={{ width: "100%" }} onClick={() => inputs.current[kind]?.click()}>
            <Icon d={LAB_ICONS.upload} size={26} />
            <span>{busy === kind ? "جارٍ الضغط…" : hint}</span>
            <span className={s.small}>يتم الضغط تلقائيًا إلى ≤ ٣٠٠ كيلوبايت</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={s.grid2}>
      <Panel id="lab-reimb" title="بوابة المصروفات" hint="البند ٥: المأموريات الخارجية تتطلب لقطة من تطبيق النقل (خط السير + البداية والنهاية + السعر). المشتريات تتطلب موافقة مسبقة وعرض سعر، ثم فاتورة مطابقة.">
        <div className={s.chips} style={{ marginBottom: 14 }}>
          <button type="button" id="lab-reimb-type-outdoor" className={cx(s.chip, type === "outdoor" && s.chipActive)} onClick={() => switchType("outdoor")}>
            🚕 مأمورية خارجية
          </button>
          <button type="button" id="lab-reimb-type-purchase" className={cx(s.chip, type === "purchase" && s.chipActive)} onClick={() => switchType("purchase")}>
            🛒 مشتريات
          </button>
        </div>

        {type === "outdoor" ? (
          <div className={s.grid3}>
            <div>
              <label className={s.label} htmlFor="lab-reimb-from">من</label>
              <input id="lab-reimb-from" className={s.input} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className={s.label} htmlFor="lab-reimb-to">إلى</label>
              <input id="lab-reimb-to" className={s.input} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <label className={s.label} htmlFor="lab-reimb-amount">سعر الرحلة</label>
              <input id="lab-reimb-amount" type="number" min={0} className={cx(s.input, s.mono)} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
            </div>
          </div>
        ) : (
          <div className={s.grid3}>
            <div>
              <label className={s.label} htmlFor="lab-reimb-amount">المبلغ التقديري</label>
              <input id="lab-reimb-amount" type="number" min={0} className={cx(s.input, s.mono)} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} disabled={!!stage && stage !== "pre_approval"} />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <label className={s.label} htmlFor="lab-reimb-link">رابط عرض السعر (اختياري بدل الصورة)</label>
              <input id="lab-reimb-link" className={cx(s.input, s.mono)} dir="ltr" placeholder="https://…" value={quoteLink} onChange={(e) => setQuoteLink(e.target.value)} />
            </div>
            {(stage === "pending_invoice" || stage === "review" || stage === "approved") && (
              <div>
                <label className={s.label} htmlFor="lab-reimb-invoice-amount">قيمة الفاتورة</label>
                <input id="lab-reimb-invoice-amount" type="number" min={0} className={cx(s.input, s.mono)} value={invoiceAmount} onChange={(e) => setInvoiceAmount(Number(e.target.value) || 0)} disabled={stage === "approved"} />
              </div>
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 14 }}>
          {type === "outdoor" && slot("ride_screenshot", "لقطة تطبيق النقل", "ارفع لقطة الشاشة من Uber / Careem")}
          {type === "purchase" && slot("quote", "عرض السعر", "لقطة عرض السعر")}
          {type === "purchase" && (stage === "pending_invoice" || stage === "review" || stage === "approved") && slot("invoice", "الفاتورة المبدئية / النهائية", "ارفع الفاتورة")}
        </div>
        {err && <div className={cx(s.result, s.bad)} style={{ marginTop: 12 }}>{err}</div>}
      </Panel>

      <Panel id="lab-reimb-review" title="مراجعة الإدارة" tag={stage ? REIMBURSEMENT_STAGE_AR[stage] : "مسودة"}>
        <div className={s.steps}>
          {flow.map((st, i) => (
            <span key={st} style={{ display: "contents" }}>
              <span className={cx(s.step, stage === "rejected" ? undefined : i < idx || stage === "approved" ? s.stepDone : i === idx ? s.stepNow : undefined)}>{REIMBURSEMENT_STAGE_AR[st]}</span>
              {i < flow.length - 1 && <span className={s.stepArrow}>←</span>}
            </span>
          ))}
          {stage === "rejected" && <span className={cx(s.pill, s.pBad)}>مرفوض</span>}
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {CHECKS[type].map((c) => (
            <button key={c.key} type="button" id={`lab-reimb-check-${c.key}`} className={cx(s.check, checks[c.key] && s.checkOn)} style={{ background: "transparent", color: "inherit", textAlign: "start" }} onClick={() => setChecks((x) => ({ ...x, [c.key]: !x[c.key] }))}>
              <span className={s.checkBox}>{checks[c.key] && <Icon d={LAB_ICONS.check} size={12} />}</span>
              {c.ar}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
          {flags.length === 0 ? (
            <div className={cx(s.result, s.ok)}>✓ لا توجد ملاحظات — المستندات مكتملة.</div>
          ) : (
            flags.map((f) => (
              <div key={f.code} className={cx(s.result, f.severity === "error" ? s.bad : s.warn)} style={{ padding: "9px 12px", fontSize: 13 }}>
                {f.messageAr}
              </div>
            ))
          )}
        </div>

        {approvedAmount != null && (
          <p className={s.small} style={{ marginTop: 10 }}>
            المبلغ المعتمد مسبقًا: <b className={s.mono}>{money(approvedAmount)}</b>
            {cfg.invoiceTolerancePct ? ` · سماحية ${ar(cfg.invoiceTolerancePct)}٪` : " · بدون سماحية"}
          </p>
        )}

        <div className={s.divider} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {!stage && (
            <button type="button" id="lab-reimb-submit" className={s.btn} onClick={submit}>
              إرسال الطلب
            </button>
          )}
          {stage && stage !== "approved" && stage !== "rejected" && (
            <>
              <button
                type="button"
                id="lab-reimb-advance"
                className={s.btn}
                onClick={advance}
                disabled={!canAdvance}
              >
                {stage === "pre_approval" ? "موافقة مسبقة" : stage === "pending_invoice" ? "رفع الفاتورة (الموظف)" : "اعتماد وإضافة للراتب"}
              </button>
              <button type="button" id="lab-reimb-reject" className={s.btnGhost} onClick={reject}>
                رفض
              </button>
            </>
          )}
          {(stage === "approved" || stage === "rejected") && (
            <button type="button" id="lab-reimb-restart" className={s.btnGhost} onClick={restart}>
              طلب جديد ↺
            </button>
          )}
        </div>
        {stage === "approved" && (
          <div className={cx(s.result, s.ok)} style={{ marginTop: 12 }}>
            تم الاعتماد — يضاف {money(type === "purchase" ? Math.min(invoiceAmount || amount, approvedAmount ?? amount) : amount)} كبدل في مسير الراتب. إعادة استخدام نفس الصورة لاحقًا سيتم اكتشافها تلقائيًا (بصمة SHA-256).
          </div>
        )}
      </Panel>
    </div>
  );
}
