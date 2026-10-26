"use client";

import { useEffect, useState } from "react";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import {
  type HrSettings,
  type WorkLocationItem,
  type OfficeNetworkItem,
  DEFAULT_HR_SETTINGS,
  parseLocationCoordinates,
  computeDailyOfficePin,
  fetchClientPublicIp,
} from "@/lib/admin/hrReports";
import { saveHrSettings } from "@/lib/admin/hrSettings";
import { toast } from "@/lib/admin/feedback";
import { useHrLang } from "@/lib/admin/hrI18n";

interface Props {
  initialSettings: HrSettings;
  onClose: () => void;
  adminEmail?: string;
}

const WEEKEND_OPTIONS = [
  { value: 5, ar: "الجمعة (Friday)", en: "Friday (الجمعة)" },
  { value: 6, ar: "السبت (Saturday)", en: "Saturday (السبت)" },
  { value: 0, ar: "الأحد (Sunday)", en: "Sunday (الأحد)" },
  { value: 4, ar: "الخميس (Thursday)", en: "Thursday (الخميس)" },
];

const INPUT_CLS =
  "w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-2.5 py-1.5 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600 rounded";

function PolicyField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-zinc-400 mt-0.5">{hint}</span>}
    </label>
  );
}

function NumField({
  label,
  hint,
  value,
  def,
  step = 1,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number | undefined;
  def: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <PolicyField label={label} hint={hint}>
      <input
        type="number"
        min={0}
        step={step}
        value={value ?? def}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          onChange(Number.isFinite(n) && n >= 0 ? n : def);
        }}
        className={INPUT_CLS}
      />
    </PolicyField>
  );
}

export default function HrPolicyModal({ initialSettings, onClose, adminEmail }: Props) {
  const [settings, setSettings] = useState<HrSettings>({
    ...initialSettings,
    workLocations: initialSettings.workLocations ?? [],
    enforceGeofence: initialSettings.enforceGeofence ?? true,
    officeNetworks: initialSettings.officeNetworks ?? [],
    officePinEnabled: initialSettings.officePinEnabled ?? true,
    officePinMode: initialSettings.officePinMode ?? "daily_auto",
    officePinFixedCode: initialSettings.officePinFixedCode ?? "2026",
    officePinSalt: initialSettings.officePinSalt ?? "mft_office_pin_2026",
    officeDeviceAuthSecret: initialSettings.officeDeviceAuthSecret ?? "MFT-OFFICE-2026",
  });
  const [saving, setSaving] = useState(false);
  const { isAr, dir, toggleLang, t } = useHrLang();

  // New Work Location builder state
  const [locName, setLocName] = useState("");
  const [locLat, setLocLat] = useState("");
  const [locLng, setLocLng] = useState("");
  const [locRadius, setLocRadius] = useState(200);
  const [locPasteUrl, setLocPasteUrl] = useState("");
  const [locGettingGps, setLocGettingGps] = useState(false);

  // Office Wi-Fi / IP state (for GPS-less devices)
  const [currentPublicIp, setCurrentPublicIp] = useState<string | null>(null);
  const [loadingIp, setLoadingIp] = useState(false);
  const [netName, setNetName] = useState("");
  const [netIp, setNetIp] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoadingIp(true);
    fetchClientPublicIp()
      .then((ip) => {
        if (mounted && ip) {
          setCurrentPublicIp(ip);
        }
      })
      .finally(() => {
        if (mounted) setLoadingIp(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleAddCurrentOfficeIp = () => {
    if (!currentPublicIp) {
      toast.warning(t("لم يتم اكتشاف الـ IP الحالي بعد", "Current Public IP not detected yet"));
      return;
    }
    const existing = (settings.officeNetworks ?? []).some((n) => n.ip.trim() === currentPublicIp.trim());
    if (existing) {
      toast.info(t("شبكة الشركة الحالية مسجلة بالفعل في القائمة ✓", "Current Office IP is already in the list ✓"));
      return;
    }
    const newNet: OfficeNetworkItem = {
      id: `net_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: netName.trim() || t("راوتر / شبكة المقر الرئيسي", "Main Office Wi-Fi / Router"),
      ip: currentPublicIp.trim(),
      active: true,
    };
    setSettings((prev) => ({
      ...prev,
      officeNetworks: [...(prev.officeNetworks ?? []), newNet],
    }));
    setNetName("");
    toast.success(
      t(
        `تمت إضافة شبكة الشركة (${newNet.ip}) — اضغط حفظ السياسات لتأكيد التفعيل`,
        `Added Office Network (${newNet.ip}) — click Save Policies`,
      ),
    );
  };

  const handleAddCustomOfficeIp = () => {
    const clean = netIp.trim();
    if (!clean) {
      toast.warning(t("يرجى كتابة عنوان الـ IP لشبكة الشركة", "Please enter an IP address"));
      return;
    }
    const newNet: OfficeNetworkItem = {
      id: `net_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: netName.trim() || t("شبكة مكتب الشركة", "Office Network"),
      ip: clean,
      active: true,
    };
    setSettings((prev) => ({
      ...prev,
      officeNetworks: [...(prev.officeNetworks ?? []), newNet],
    }));
    setNetName("");
    setNetIp("");
    toast.success(t(`تمت إضافة الشبكة (${clean})`, `Added network (${clean})`));
  };

  const handleToggleOfficeNetwork = (id: string) => {
    setSettings((prev) => ({
      ...prev,
      officeNetworks: (prev.officeNetworks ?? []).map((n) =>
        n.id === id ? { ...n, active: n.active === false ? true : false } : n,
      ),
    }));
  };

  const handleRemoveOfficeNetwork = (id: string) => {
    setSettings((prev) => ({
      ...prev,
      officeNetworks: (prev.officeNetworks ?? []).filter((n) => n.id !== id),
    }));
  };

  const handleRegenerateDailyPin = () => {
    const newSalt = `mft_pin_${Date.now().toString(36)}`;
    setSettings((prev) => ({
      ...prev,
      officePinSalt: newSalt,
      officePinMode: "daily_auto",
      officePinEnabled: true,
    }));
    toast.success(t("تم توليد كود حضور يومي جديد للمكتب — اضغط حفظ السياسات لاعتماده", "New daily Office PIN generated"));
  };

  const handleCaptureCurrentGps = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.warning(t("المتصفح لا يدعم تحديد الموقع الجغرافي", "Browser does not support Geolocation"));
      return;
    }
    setLocGettingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocLat(pos.coords.latitude.toFixed(6));
        setLocLng(pos.coords.longitude.toFixed(6));
        if (!locName.trim()) {
          setLocName(t("المكتب الرئيسي", "Main Office"));
        }
        setLocGettingGps(false);
        toast.success(t("تم التقاط إحداثيات موقعك الحالي بنجاح ✓", "Current GPS coordinates captured ✓"));
      },
      (err) => {
        setLocGettingGps(false);
        toast.error(t("تعذر التقاط الموقع الحالي", "Failed to get current GPS"), {
          description: err.message,
        });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handlePasteCoordinates = (val: string) => {
    setLocPasteUrl(val);
    const parsed = parseLocationCoordinates(val);
    if (parsed) {
      setLocLat(String(parsed.lat));
      setLocLng(String(parsed.lng));
      toast.success(
        t(
          `تم استخراج الإحداثيات: ${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`,
          `Extracted coordinates: ${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)}`,
        ),
      );
    }
  };

  const handleAddLocation = () => {
    const lat = parseFloat(locLat);
    const lng = parseFloat(locLng);
    if (!locName.trim()) {
      toast.warning(t("يرجى إدخال اسم الموقع (مثال: المكتب الرئيسي)", "Please enter a location name"));
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      toast.warning(
        t(
          "يرجى إدخال خط العرض (Latitude) وخط الطول (Longitude) بشكل صحيح أو الضغط على «التقط موقعي الحالي».",
          "Please enter valid Latitude & Longitude or click 'Use Current GPS'.",
        ),
      );
      return;
    }
    const newLoc: WorkLocationItem = {
      id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: locName.trim(),
      lat,
      lng,
      radiusMeters: Math.max(30, Number(locRadius) || 200),
      active: true,
    };
    setSettings((prev) => ({
      ...prev,
      workLocations: [...(prev.workLocations ?? []), newLoc],
      enforceGeofence: true,
    }));
    setLocName("");
    setLocLat("");
    setLocLng("");
    setLocPasteUrl("");
    setLocRadius(200);
    toast.success(t(`تمت إضافة موقع «${newLoc.name}» — اضغط حفظ السياسات لتأكيد التفعيل`, `Added "${newLoc.name}"`));
  };

  const handleToggleLocationActive = (id: string) => {
    setSettings((prev) => ({
      ...prev,
      workLocations: (prev.workLocations ?? []).map((l) =>
        l.id === id ? { ...l, active: l.active === false ? true : false } : l,
      ),
    }));
  };

  const handleRemoveLocation = (id: string) => {
    setSettings((prev) => ({
      ...prev,
      workLocations: (prev.workLocations ?? []).filter((l) => l.id !== id),
    }));
  };

  const toggleWeekend = (day: number) => {
    setSettings((prev) => {
      const exists = prev.weekendDays.includes(day);
      if (exists) {
        if (prev.weekendDays.length <= 1) {
          toast.warning(t("يجب تحديد يوم راحة أسبوعي واحد على الأقل", "At least one weekly rest day is required"));
          return prev;
        }
        return { ...prev, weekendDays: prev.weekendDays.filter((d) => d !== day) };
      }
      return { ...prev, weekendDays: [...prev.weekendDays, day].sort() };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveHrSettings(settings, adminEmail);
      toast.success(t("تم حفظ سياسات الموارد البشرية والرواتب بنجاح", "HR & Payroll policies updated"));
      onClose();
    } catch (err) {
      toast.error(t("فشل حفظ الإعدادات", "Failed to save settings"), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const lateCutoff = (() => {
    const [h, m] = (settings.shiftStartTime || "10:00").split(":").map((x) => parseInt(x, 10) || 0);
    const total = h * 60 + m + (settings.gracePeriodMinutes || 0);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  })();

  return (
    <ModalPortal onClose={onClose}>
      <div
        className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
        onClick={onClose}
      >
        <div
          dir={dir}
          className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-6 md:p-7 animate-scale-in text-zinc-950 dark:text-zinc-100 font-mono rounded-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 pb-4 border-b-2 border-zinc-900 dark:border-zinc-700 mb-5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-600 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-2 py-0.5 rounded">
                {t("إعدادات لائحة العمل والرواتب · HR-POL-2026", "// HR & PAYROLL POLICY SETTINGS")}
              </span>
              <h3 className="text-xl md:text-2xl font-bold font-heading tracking-wide mt-1 text-zinc-950 dark:text-white">
                {t("إعدادات الموارد البشرية والرواتب", "HR & Payroll Policy Settings")}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                {t(
                  "تحكم في بداية الدورة الشهرية، مواعيد العمل، الأذونات الشهرية، مضاعف الإضافي (النهاري والليلي)، ورصيد الإجازات.",
                  "Configure the monthly payroll cycle, shift hours, monthly permissions, day/night overtime rates, and leave accrual.",
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={toggleLang}
                className="px-2.5 py-1 border-2 border-zinc-900 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-xs font-bold rounded cursor-pointer hover:bg-red-600 hover:text-white transition-colors"
              >
                {isAr ? "English" : "العربية"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white text-2xl font-bold leading-none p-1 cursor-pointer"
              >
                &times;
              </button>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-5 text-xs">
            {/* Master HR-POL-2026 Switch Banner */}
            <div
              className={`p-4 border-2 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                settings.policy2026Enabled
                  ? "border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/25"
                  : "border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60"
              }`}
            >
              <div className="space-y-1">
                <div className="font-bold text-sm text-zinc-900 dark:text-white flex items-center gap-2">
                  <span className={settings.policy2026Enabled ? "text-emerald-600" : "text-zinc-400"}>●</span>
                  <span>
                    {t(
                      "تفعيل لائحة السياسات الداخلية الجديدة (HR-POL-2026)",
                      "Enable HR-POL-2026 Policy Engine (لائحة السياسات الداخلية)",
                    )}
                  </span>
                </div>
                <p className="text-zinc-600 dark:text-zinc-400 text-[11px]">
                  {t(
                    "عند التفعيل: تُغطى التأخيرات من رصيد الأذونات الشهري أولاً، ويُحسب الإضافي المعتمد بنظام (نهاري 1.35x / ليلي 1.70x)، وتتراكم الإجازات تلقائيًا من تاريخ التعيين.",
                    "When active: lateness uses monthly permissions first, approved overtime uses Day (1.35x) & Night (1.70x) multipliers, and annual leave accrues from each worker's joining date.",
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-36">
                  <label className="block text-[10px] font-bold text-zinc-600 dark:text-zinc-300 mb-0.5">
                    {t("تاريخ بدء التطبيق", "Effective From")}
                  </label>
                  <input
                    type="date"
                    value={settings.policy2026EffectiveFrom ?? "2026-10-21"}
                    onChange={(e) => setSettings({ ...settings, policy2026EffectiveFrom: e.target.value })}
                    className={INPUT_CLS}
                  />
                </div>
                <button
                  type="button"
                  id="policy2026-toggle"
                  role="switch"
                  aria-checked={!!settings.policy2026Enabled}
                  onClick={() => setSettings({ ...settings, policy2026Enabled: !settings.policy2026Enabled })}
                  className={`relative shrink-0 h-7 w-12 rounded-full border-2 border-zinc-900 transition-colors cursor-pointer ${
                    settings.policy2026Enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white border border-zinc-900 transition-all ${
                      settings.policy2026Enabled ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* 1. Monthly Cycle & Rest Days */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-300 dark:border-zinc-700 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-sm text-zinc-900 dark:text-white flex items-center gap-2">
                    <span className="text-red-600">١.</span>
                    <span>{t("بداية الدورة الشهرية والعطلة الأسبوعية", "1. Monthly Payroll Cycle & Weekly Rest Days")}</span>
                  </h4>
                  <p className="text-zinc-500 dark:text-zinc-400 text-[11px] mt-0.5">
                    {t(
                      "يحدد يوم بداية ونهاية شهر الرواتب ورصيد الأذونات الشهري وأيام الراحة المدفوعة.",
                      "Controls the monthly cutoff day for payroll, permission quotas, and weekly rest days.",
                    )}
                  </p>
                </div>
                <span className="px-2.5 py-1 bg-red-600 text-white font-bold rounded text-xs shrink-0">
                  {t(`يوم ${settings.monthStartDay}`, `Day ${settings.monthStartDay}`)}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                {[
                  { day: 21, ar: "يوم 21 (21 إلى 20)", en: "21st (21st–20th)", subAr: "النظام المعتاد", subEn: "Standard" },
                  { day: 25, ar: "يوم 25 (25 إلى 24)", en: "25th (25th–24th)", subAr: "نهاية الشهر", subEn: "Late Cutoff" },
                  { day: 1, ar: "يوم 1 (أول الشهر)", en: "1st (Calendar)", subAr: "1 إلى آخر الشهر", subEn: "1st–End" },
                  { day: 15, ar: "يوم 15 (منتصف الشهر)", en: "15th (Mid-month)", subAr: "15 إلى 14", subEn: "15th–14th" },
                ].map((preset) => (
                  <button
                    key={preset.day}
                    type="button"
                    onClick={() => setSettings({ ...settings, monthStartDay: preset.day })}
                    className={`p-2 rounded border text-start cursor-pointer transition-all ${
                      settings.monthStartDay === preset.day
                        ? "border-red-600 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 ring-2 ring-red-600/20 font-bold"
                        : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100"
                    }`}
                  >
                    <div className="font-bold text-xs">{isAr ? preset.ar : preset.en}</div>
                    <div className="text-[10px] text-zinc-400 mt-0.5">{isAr ? preset.subAr : preset.subEn}</div>
                  </button>
                ))}
                <div className="p-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col justify-between">
                  <span className="text-[10px] font-bold text-zinc-500">
                    {t("يوم مخصص (1–28):", "Custom Day (1–28):")}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={settings.monthStartDay}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        monthStartDay: Math.min(28, Math.max(1, parseInt(e.target.value, 10) || 1)),
                      })
                    }
                    className="mt-1 w-full px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-400 text-center font-bold text-xs rounded"
                  />
                </div>
              </div>

              <div className="pt-2">
                <span className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  {t("أيام العطلة الأسبوعية (لا يُحسب فيها غياب):", "Weekly Rest Days (Excluded from absences):")}
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {WEEKEND_OPTIONS.map((opt) => {
                    const checked = settings.weekendDays.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleWeekend(opt.value)}
                        className={`p-2 rounded border text-start flex items-center justify-between cursor-pointer transition-all ${
                          checked
                            ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold"
                            : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400"
                        }`}
                      >
                        <span>{isAr ? opt.ar : opt.en}</span>
                        <span className="text-sm">{checked ? "✓" : "○"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 2. Shift Schedule & Monthly Permissions */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-300 dark:border-zinc-700 rounded-lg space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-bold text-sm text-zinc-900 dark:text-white flex items-center gap-2">
                    <span className="text-red-600">٢.</span>
                    <span>{t("مواعيد العمل ورصيد الأذونات الشهرية", "2. Shift Schedule & Monthly Permissions Quota")}</span>
                  </h4>
                  <p className="text-zinc-500 dark:text-zinc-400 text-[11px] mt-0.5">
                    {t(
                      `الحضور حتى ${lateCutoff} يُعد في الموعد. بعد ${lateCutoff} يُخصم من رصيد الأذونات الشهري تلقائيًا قبل تطبيق أي جزاء.`,
                      `Clock-in up to ${lateCutoff} is On-Time. After ${lateCutoff}, lateness is covered by the monthly permission quota first.`,
                    )}
                  </p>
                </div>
                <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded text-[11px] font-bold">
                  {t(`حد التأخير: ${lateCutoff}`, `Late Cutoff: ${lateCutoff}`)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <PolicyField label={t("بداية الوردية (Shift Start)", "Shift Start (بداية الوردية)")}>
                  <select
                    value={settings.shiftStartTime}
                    onChange={(e) => setSettings({ ...settings, shiftStartTime: e.target.value })}
                    className={INPUT_CLS}
                  >
                    <option value="08:00">08:00 AM</option>
                    <option value="08:30">08:30 AM</option>
                    <option value="09:00">09:00 AM</option>
                    <option value="09:30">09:30 AM</option>
                    <option value="10:00">10:00 AM ({t("افتراضي", "Default")})</option>
                    <option value="10:30">10:30 AM</option>
                    <option value="11:00">11:00 AM</option>
                  </select>
                </PolicyField>

                <PolicyField label={t("فترة السماح المرنة (Grace Period)", "Grace Period (سماحية الحضور)")}>
                  <select
                    value={settings.gracePeriodMinutes}
                    onChange={(e) =>
                      setSettings({ ...settings, gracePeriodMinutes: parseInt(e.target.value, 10) || 60 })
                    }
                    className={INPUT_CLS}
                  >
                    <option value={15}>{t("15 دقيقة", "15 minutes")}</option>
                    <option value={30}>{t("30 دقيقة", "30 minutes")}</option>
                    <option value={45}>{t("45 دقيقة", "45 minutes")}</option>
                    <option value={60}>{t("60 دقيقة (ساعة كاملة)", "60 minutes (1 hour)")}</option>
                    <option value={90}>{t("90 دقيقة (ساعة ونصف)", "90 minutes (1.5h)")}</option>
                  </select>
                </PolicyField>

                <PolicyField label={t("عدد ساعات العمل اليومية", "Standard Shift Hours")}>
                  <select
                    value={settings.standardHours}
                    onChange={(e) =>
                      setSettings({ ...settings, standardHours: parseInt(e.target.value, 10) || 8 })
                    }
                    className={INPUT_CLS}
                  >
                    <option value={6}>{t("6 ساعات", "6 hours")}</option>
                    <option value={7}>{t("7 ساعات", "7 hours")}</option>
                    <option value={8}>{t("8 ساعات (قياسي)", "8 hours (Standard)")}</option>
                    <option value={9}>{t("9 ساعات", "9 hours")}</option>
                    <option value={10}>{t("10 ساعات", "10 hours")}</option>
                  </select>
                </PolicyField>
              </div>

              {settings.policy2026Enabled && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                  <NumField
                    label={t("عدد الأذونات / شهر", "Max Permissions")}
                    hint={t("افتراضي: 4 أذونات", "Default: 4 / cycle")}
                    value={settings.permissionMaxCount}
                    def={4}
                    onChange={(v) => setSettings({ ...settings, permissionMaxCount: v })}
                  />
                  <NumField
                    label={t("إجمالي الدقائق / شهر", "Max Total Minutes")}
                    hint={t("افتراضي: 240 د (4 ساعات)", "Default: 240 min")}
                    value={settings.permissionMaxMinutes}
                    def={240}
                    onChange={(v) => setSettings({ ...settings, permissionMaxMinutes: v })}
                  />
                  <NumField
                    label={t("أقل مدة للإذن (د)", "Min / Permission")}
                    hint={t("افتراضي: 30 دقيقة", "Default: 30 min")}
                    value={settings.permissionMinMinutes}
                    def={30}
                    onChange={(v) => setSettings({ ...settings, permissionMinMinutes: v })}
                  />
                  <NumField
                    label={t("أقصى مدة للإذن (د)", "Max / Permission")}
                    hint={t("افتراضي: 120 دقيقة", "Default: 120 min")}
                    value={settings.permissionMaxSingleMinutes}
                    def={120}
                    onChange={(v) => setSettings({ ...settings, permissionMaxSingleMinutes: v })}
                  />
                  <NumField
                    label={t("تقريب الدقائق (د)", "Rounding Block")}
                    hint={t("مضاعفات 15 دقيقة", "15-min blocks")}
                    value={settings.permissionRoundingBlock}
                    def={15}
                    onChange={(v) => setSettings({ ...settings, permissionRoundingBlock: v })}
                  />
                </div>
              )}
            </div>

            {/* 3. Unified Overtime & Absence Rules (NO DUPLICATE DAY OT CONTROLS) */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-300 dark:border-zinc-700 rounded-lg space-y-3">
              <div>
                <h4 className="font-bold text-sm text-zinc-900 dark:text-white flex items-center gap-2">
                  <span className="text-red-600">٣.</span>
                  <span>{t("قواعد العمل الإضافي والغياب (Overtime & Absence)", "3. Overtime Multipliers & Absence Penalty")}</span>
                </h4>
                <p className="text-zinc-500 dark:text-zinc-400 text-[11px] mt-0.5">
                  {settings.policy2026Enabled
                    ? t(
                        "يُحسب العمل الإضافي المعتمد حسب توقيت الساعة: إضافي نهاري (06:00 ص – 18:00 م) وإضافي ليلي (18:00 م – 06:00 ص).",
                        "Approved overtime is split automatically between the Day window (06:00–18:00) and Night window (18:00–06:00).",
                      )
                    : t(
                        "النظام الكلاسيكي: يُحسب الإضافي بمضاعف موحد.",
                        "Legacy mode: overtime uses a single flat multiplier.",
                      )}
                </p>
              </div>

              {settings.policy2026Enabled ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded">
                      <NumField
                        label={t("☀️ مضاعف الإضافي النهاري (Day OT ×)", "☀️ Day Overtime Multiplier (×)")}
                        hint={t(`من ${settings.dayWindowStart ?? "06:00"} إلى ${settings.nightWindowStart ?? "18:00"} (افتراضي 1.35x)`, `Window ${settings.dayWindowStart ?? "06:00"}–${settings.nightWindowStart ?? "18:00"} (Default 1.35x)`)}
                        step={0.05}
                        value={settings.dayOtMultiplier}
                        def={1.35}
                        onChange={(v) => setSettings({ ...settings, dayOtMultiplier: v })}
                      />
                    </div>
                    <div className="p-3 bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-300 dark:border-indigo-800 rounded">
                      <NumField
                        label={t("🌙 مضاعف الإضافي الليلي (Night OT ×)", "🌙 Night Overtime Multiplier (×)")}
                        hint={t(`من ${settings.nightWindowStart ?? "18:00"} إلى ${settings.dayWindowStart ?? "06:00"} (افتراضي 1.70x)`, `Window ${settings.nightWindowStart ?? "18:00"}–${settings.dayWindowStart ?? "06:00"} (Default 1.70x)`)}
                        step={0.05}
                        value={settings.nightOtMultiplier}
                        def={1.7}
                        onChange={(v) => setSettings({ ...settings, nightOtMultiplier: v })}
                      />
                    </div>
                    <div className="p-3 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded">
                      <NumField
                        label={t("بدل الوردية الليلية (ج.م/يوم)", "Night Shift Allowance (EGP)")}
                        hint={t("مبلغ إضافي ثابت لليوم الليلي", "Extra flat EGP per night-OT day")}
                        value={settings.nightShiftAllowance}
                        def={0}
                        onChange={(v) => setSettings({ ...settings, nightShiftAllowance: v })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <PolicyField label={t("بداية الفترة النهارية", "Day Window Starts")}>
                      <input
                        type="time"
                        value={settings.dayWindowStart ?? "06:00"}
                        onChange={(e) => setSettings({ ...settings, dayWindowStart: e.target.value })}
                        className={INPUT_CLS}
                      />
                    </PolicyField>
                    <PolicyField label={t("بداية الفترة الليلية", "Night Window Starts")}>
                      <input
                        type="time"
                        value={settings.nightWindowStart ?? "18:00"}
                        onChange={(e) => setSettings({ ...settings, nightWindowStart: e.target.value })}
                        className={INPUT_CLS}
                      />
                    </PolicyField>
                    <PolicyField label={t("جزاء الغياب بدون إذن (Absence)", "Unexcused Absence Penalty")}>
                      <select
                        value={settings.absencePenaltyMultiplier}
                        onChange={(e) =>
                          setSettings({ ...settings, absencePenaltyMultiplier: parseInt(e.target.value, 10) || 2 })
                        }
                        className={INPUT_CLS}
                      >
                        <option value={1}>{t("خصم يوم واحد (1x)", "1x daily pay")}</option>
                        <option value={2}>{t("خصم يومين (2x - قياسي)", "2x daily pay (Standard)")}</option>
                        <option value={3}>{t("خصم 3 أيام (3x)", "3x daily pay")}</option>
                      </select>
                    </PolicyField>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PolicyField label={t("مضاعف الإضافي الموحد (Legacy OT)", "Flat Overtime Multiplier (Legacy)")}>
                    <select
                      value={settings.overtimeMultiplier}
                      onChange={(e) =>
                        setSettings({ ...settings, overtimeMultiplier: parseFloat(e.target.value) || 1.5 })
                      }
                      className={INPUT_CLS}
                    >
                      <option value={1.25}>1.25x</option>
                      <option value={1.5}>1.50x ({t("قياسي", "Standard")})</option>
                      <option value={1.75}>1.75x</option>
                      <option value={2.0}>2.00x</option>
                    </select>
                  </PolicyField>
                  <PolicyField label={t("جزاء الغياب بدون إذن", "Unexcused Absence Penalty")}>
                    <select
                      value={settings.absencePenaltyMultiplier}
                      onChange={(e) =>
                        setSettings({ ...settings, absencePenaltyMultiplier: parseInt(e.target.value, 10) || 2 })
                      }
                      className={INPUT_CLS}
                    >
                      <option value={1}>{t("خصم يوم واحد (1x)", "1x daily pay")}</option>
                      <option value={2}>{t("خصم يومين (2x - قياسي)", "2x daily pay (Standard)")}</option>
                      <option value={3}>{t("خصم 3 أيام (3x)", "3x daily pay")}</option>
                    </select>
                  </PolicyField>
                </div>
              )}
            </div>

            {/* 4. Annual Leave Accrual & Reimbursements */}
            {settings.policy2026Enabled && (
              <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-300 dark:border-zinc-700 rounded-lg space-y-3">
                <div>
                  <h4 className="font-bold text-sm text-zinc-900 dark:text-white flex items-center gap-2">
                    <span className="text-red-600">٤.</span>
                    <span>{t("الإجازات السنوية والمصروفات (Leave & Reimbursements)", "4. Annual Leave Tiers & Expense Validation")}</span>
                  </h4>
                  <p className="text-zinc-500 dark:text-zinc-400 text-[11px] mt-0.5">
                    {t(
                      "يُحسب رصيد الإجازات آليًا من «تاريخ التعيين بالشركة» لكل موظف بعد انتهاء فترة الاختبار.",
                      "Annual leave accrues automatically from each worker's Company Joining Date after completing probation.",
                    )}
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <NumField
                    label={t("فترة الاختبار (شهور)", "Probation (Months)")}
                    hint={t("افتراضي: 6 أشهر", "Default: 6 mo")}
                    value={settings.probationMonths}
                    def={6}
                    onChange={(v) => setSettings({ ...settings, probationMonths: v })}
                  />
                  <NumField
                    label={t("رصيد السنة الأولى / شهر", "Year-1 Rate / Mo")}
                    hint={t("1.25 = 15 يوم/سنة", "1.25 = 15d/year")}
                    step={0.05}
                    value={settings.leaveRateYear1}
                    def={1.25}
                    onChange={(v) => setSettings({ ...settings, leaveRateYear1: v })}
                  />
                  <NumField
                    label={t("رصيد السنة 2+ / شهر", "Year-2+ Rate / Mo")}
                    hint={t("1.75 = 21 يوم/سنة", "1.75 = 21d/year")}
                    step={0.05}
                    value={settings.leaveRateYear2}
                    def={1.75}
                    onChange={(v) => setSettings({ ...settings, leaveRateYear2: v })}
                  />
                  <NumField
                    label={t("أقصى ترحيل سنوي (أيام)", "Max Carry-Over (d)")}
                    hint={t("افتراضي: 7 أيام", "Default: 7 days")}
                    value={settings.maxCarryOverDays}
                    def={7}
                    onChange={(v) => setSettings({ ...settings, maxCarryOverDays: v })}
                  />
                  <NumField
                    label={t("سماحية الفواتير (%)", "Invoice Tolerance %")}
                    hint={t("0% = مطابقة تامة", "0% = exact match")}
                    value={settings.invoiceTolerancePct}
                    def={0}
                    onChange={(v) => setSettings({ ...settings, invoiceTolerancePct: v })}
                  />
                </div>
              </div>
            )}

            {/* 5. Allowed Work Locations (Geofencing & External Mission Gate) */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border-2 border-zinc-900 dark:border-zinc-700 rounded-lg space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-bold text-sm text-zinc-900 dark:text-white flex items-center gap-2">
                    <span className="text-red-600">٥.</span>
                    <span>
                      {t(
                        "📍 مواقع العمل المعتمدة وبوابة المأموريات الخارجية (Geofence)",
                        "5. 📍 Allowed Work Locations & External Mission Gate",
                      )}
                    </span>
                  </h4>
                  <p className="text-zinc-500 dark:text-zinc-400 text-[11px] mt-0.5">
                    {t(
                      "إذا كان الموظف خارج جميع المواقع المفعّلة، لن يقبل النظام بدء الشيفت العادي، وسيُطلب منه إرسال طلب مأمورية خارجية بعدد الساعات وسكرين شوت للموافقة عليها.",
                      "If a worker is outside all active locations, regular shift clock-in is blocked and they must submit an External Mission request (with hours & screenshot) for Admin approval.",
                    )}
                  </p>
                </div>

                <label className="flex items-center gap-2 px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.enforceGeofence !== false}
                    onChange={(e) => setSettings({ ...settings, enforceGeofence: e.target.checked })}
                    className="h-4 w-4 accent-emerald-600 cursor-pointer"
                  />
                  <span className="text-[11px] font-bold">
                    {t("إلزام التواجد في اللوكيشن لبدء الشيفت", "Enforce Location Gate")}
                  </span>
                </label>
              </div>

              {/* Add Location Form Box */}
              <div className="p-3 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-zinc-800 dark:text-zinc-200">
                    {t("➕ إضافة موقع عمل / فرع جديد:", "➕ Add New Office / Work Location:")}
                  </span>
                  <button
                    type="button"
                    onClick={handleCaptureCurrentGps}
                    disabled={locGettingGps}
                    className="px-2.5 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded text-[11px] font-bold cursor-pointer disabled:opacity-50"
                  >
                    {locGettingGps
                      ? t("⏳ جاري التقاط موقعك...", "⏳ Getting GPS...")
                      : t("📍 التقط موقعي الحالي الآن (GPS)", "📍 Use My Current Location")}
                  </button>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 mb-0.5">
                    {t(
                      "أو الصق رابط Google Maps أو الإحداثيات (مثال: 30.0444, 31.2357):",
                      "Or paste a Google Maps link or 'lat, lng' coordinates:",
                    )}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={locPasteUrl}
                    onChange={(e) => handlePasteCoordinates(e.target.value)}
                    placeholder="https://maps.google.com/?q=30.0444,31.2357  أو  30.0444, 31.2357"
                    className={INPUT_CLS}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <PolicyField label={t("اسم الموقع / الفرع *", "Location Name *")}>
                    <input
                      type="text"
                      value={locName}
                      onChange={(e) => setLocName(e.target.value)}
                      placeholder={t("مثال: المكتب الرئيسي", "e.g. Main Office")}
                      className={INPUT_CLS}
                    />
                  </PolicyField>
                  <PolicyField label={t("خط العرض (Latitude) *", "Latitude *")}>
                    <input
                      type="number"
                      step="any"
                      dir="ltr"
                      value={locLat}
                      onChange={(e) => setLocLat(e.target.value)}
                      placeholder="30.044420"
                      className={INPUT_CLS}
                    />
                  </PolicyField>
                  <PolicyField label={t("خط الطول (Longitude) *", "Longitude *")}>
                    <input
                      type="number"
                      step="any"
                      dir="ltr"
                      value={locLng}
                      onChange={(e) => setLocLng(e.target.value)}
                      placeholder="31.235712"
                      className={INPUT_CLS}
                    />
                  </PolicyField>
                  <PolicyField label={t("النطاق المسموح (متر)", "Allowed Radius (m)")}>
                    <select
                      value={locRadius}
                      onChange={(e) => setLocRadius(parseInt(e.target.value, 10) || 200)}
                      className={INPUT_CLS}
                    >
                      <option value={100}>{t("100 متر (دقيق)", "100 meters")}</option>
                      <option value={150}>{t("150 متر", "150 meters")}</option>
                      <option value={200}>{t("200 متر (موصى به)", "200m (Recommended)")}</option>
                      <option value={300}>{t("300 متر", "300 meters")}</option>
                      <option value={500}>{t("500 متر", "500 meters")}</option>
                      <option value={1000}>{t("1000 متر (1 كم)", "1000m (1 km)")}</option>
                    </select>
                  </PolicyField>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddLocation}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded text-xs cursor-pointer shadow-[2px_2px_0px_0px_#09090b]"
                  >
                    {t("+ أضف هذا اللوكيشن لقائمة المواقع المعتمدة", "+ Add Location to List")}
                  </button>
                </div>
              </div>

              {/* Configured Locations List */}
              {(settings.workLocations ?? []).length === 0 ? (
                <div className="p-3 rounded border border-dashed border-zinc-400 text-center text-[11px] text-zinc-500">
                  {t(
                    "لا توجد مواقع عمل مضافة حالياً (يمكن للموظفين بدء الشيفت من أي مكان حتى تضيف موقعاً واحداً على الأقل).",
                    "No work locations configured yet (workers can clock in from anywhere until at least one active location is added).",
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                    {t(
                      `المواقع المضافة (${(settings.workLocations ?? []).length} موقع):`,
                      `Configured Locations (${(settings.workLocations ?? []).length}):`,
                    )}
                  </div>
                  {(settings.workLocations ?? []).map((loc) => (
                    <div
                      key={loc.id}
                      className={`p-2.5 rounded border flex flex-wrap items-center justify-between gap-2 ${
                        loc.active !== false
                          ? "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-800"
                          : "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 opacity-60"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-xs text-zinc-950 dark:text-white">
                          📍 {loc.name}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-[10px] font-mono" dir="ltr">
                          {Number(loc.lat).toFixed(5)}, {Number(loc.lng).toFixed(5)}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200 text-[10px] font-bold">
                          {t(`النطاق: ${loc.radiusMeters || 200} متر`, `Radius: ${loc.radiusMeters || 200}m`)}
                        </span>
                        <a
                          href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] font-bold text-blue-600 hover:underline"
                        >
                          {t("🗺️ عرض على الخريطة", "🗺️ View Map")}
                        </a>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleLocationActive(loc.id)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer border ${
                            loc.active !== false
                              ? "bg-emerald-600 text-white border-emerald-700"
                              : "bg-zinc-200 text-zinc-700 border-zinc-400"
                          }`}
                        >
                          {loc.active !== false ? t("✓ مفعّل", "✓ Active") : t("متوقف", "Paused")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveLocation(loc.id)}
                          className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold cursor-pointer"
                        >
                          {t("🗑️ حذف", "🗑️ Remove")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Non-GPS Office Verification Alternatives (Wi-Fi IP + Office PIN + Trusted PC) ── */}
              <div className="mt-4 pt-4 border-t-2 border-sky-300 dark:border-sky-800 space-y-3">
                <div>
                  <h5 className="font-black text-xs sm:text-sm uppercase text-sky-950 dark:text-sky-200 flex items-center gap-1.5">
                    <span>💻</span>
                    <span>
                      {t(
                        "بدائل التحقق من التواجد داخل الشركة (للأجهزة والكمبيوترات بدون GPS)",
                        "Non-GPS Office Verification (For Desktop PCs & Devices without GPS)",
                      )}
                    </span>
                  </h5>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5">
                    {t(
                      "حتى يتمكن الموظفون الذين يعملون على أجهزة كمبيوتر مكتبية بدون GPS من بدء الشيفت فوراً من داخل الشركة دون الحاجة لطلب مأمورية:",
                      "Allow workers on desktop PCs without GPS to clock in seamlessly from inside the office:",
                    )}
                  </p>
                </div>

                {/* Method 1: Company Wi-Fi / Public IP Whitelist */}
                <div className="p-3 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-extrabold text-zinc-900 dark:text-white">
                        {t("١. التحقق التلقائي عبر شبكة إنترنت الشركة (Office Wi-Fi / IP)", "1. Automatic Office Wi-Fi / Public IP Verification")}
                      </span>
                      <p className="text-[10px] text-zinc-500">
                        {t(
                          "أي جهاز متصل بنفس راوتر/إنترنت الشركة المسجل هنا سيفتح له الشيفت تلقائياً فور الضغط على «ابدأ الشيفت» حتى لو لم يكن به GPS.",
                          "Any device connected to a registered Office Public IP will automatically pass location verification without needing GPS.",
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddCurrentOfficeIp}
                      disabled={loadingIp || !currentPublicIp}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold cursor-pointer shadow-[2px_2px_0px_0px_#09090b] disabled:opacity-50"
                    >
                      {loadingIp
                        ? t("⏳ جاري قراءة الـ IP...", "⏳ Detecting IP...")
                        : currentPublicIp
                          ? t(`📡 سجل شبكة الشركة الحالية (${currentPublicIp})`, `📡 Add Current Office IP (${currentPublicIp})`)
                          : t("تعذر قراءة الـ IP تلقائياً", "IP Not Detected")}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={netName}
                      onChange={(e) => setNetName(e.target.value)}
                      placeholder={t("اسم الشبكة (مثال: راوتر المقر الرئيسي)", "Network Label (e.g. Main Office Fiber)")}
                      className={INPUT_CLS}
                    />
                    <input
                      type="text"
                      dir="ltr"
                      value={netIp}
                      onChange={(e) => setNetIp(e.target.value)}
                      placeholder={currentPublicIp ? `${currentPublicIp} أو 197.52.*` : "197.52.104.88 أو 197.52.104.*"}
                      className={INPUT_CLS}
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomOfficeIp}
                      className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white font-bold rounded text-xs cursor-pointer"
                    >
                      {t("+ إضافة IP يدوياً", "+ Add IP Manually")}
                    </button>
                  </div>

                  {(settings.officeNetworks ?? []).length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {(settings.officeNetworks ?? []).map((net) => (
                        <div
                          key={net.id}
                          className={`p-2 rounded border flex flex-wrap items-center justify-between gap-2 ${
                            net.active !== false
                              ? "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-800"
                              : "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 opacity-60"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-zinc-900 dark:text-white">🌐 {net.name}</span>
                            <span className="px-2 py-0.5 rounded bg-white dark:bg-zinc-900 border border-zinc-300 text-[11px] font-mono font-bold" dir="ltr">
                              {net.ip}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleToggleOfficeNetwork(net.id)}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer border ${
                                net.active !== false
                                  ? "bg-emerald-600 text-white border-emerald-700"
                                  : "bg-zinc-200 text-zinc-700 border-zinc-400"
                              }`}
                            >
                              {net.active !== false ? t("✓ مفعّل", "✓ Active") : t("متوقف", "Paused")}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveOfficeNetwork(net.id)}
                              className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-[10px] font-bold cursor-pointer"
                            >
                              {t("🗑️ حذف", "🗑️ Remove")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Method 2: Daily / Fixed Office Check-In PIN */}
                <div className="p-3 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-extrabold text-zinc-900 dark:text-white">
                        {t("٢. كود حضور المكتب السريع (Office PIN Code)", "2. Office Check-In PIN Code")}
                      </span>
                      <p className="text-[10px] text-zinc-500">
                        {t(
                          "إذا تغير IP الراوتر أو كان الجهاز بدون GPS، يُدخل الموظف هذا الكود المكون من 4 أرقام ليبدأ الشيفت فوراً.",
                          "If the router IP changes or a PC has no GPS, the worker enters this 4-digit PIN to clock in immediately.",
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="px-3 py-1 rounded bg-amber-100 dark:bg-amber-950/60 border-2 border-amber-500 text-amber-950 dark:text-amber-200 flex items-center gap-2">
                        <span className="text-[10px] font-bold">{t("كود اليوم:", "Today's PIN:")}</span>
                        <strong className="font-mono text-base tracking-widest" dir="ltr">
                          {computeDailyOfficePin(settings)}
                        </strong>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const pin = computeDailyOfficePin(settings);
                          navigator.clipboard?.writeText(pin);
                          toast.success(t(`تم نسخ كود المكتب (${pin}) ✓`, `Copied Office PIN (${pin}) ✓`));
                        }}
                        className="px-2.5 py-1.5 bg-zinc-900 text-white rounded text-[10px] font-bold cursor-pointer hover:bg-zinc-800"
                      >
                        {t("📋 نسخ", "📋 Copy")}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                    <PolicyField label={t("نظام كود المكتب", "PIN Mode")}>
                      <select
                        value={settings.officePinMode || "daily_auto"}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            officePinMode: e.target.value as "daily_auto" | "fixed",
                            officePinEnabled: true,
                          })
                        }
                        className={INPUT_CLS}
                      >
                        <option value="daily_auto">{t("يتجدد تلقائياً كل يوم (موصى به)", "Auto-rotates Daily (Recommended)")}</option>
                        <option value="fixed">{t("كود ثابت يحدده الأدمن", "Fixed Custom PIN")}</option>
                      </select>
                    </PolicyField>

                    {settings.officePinMode === "fixed" ? (
                      <PolicyField label={t("الكود الثابت للمكتب (4 أرقام أو أكثر)", "Fixed Office PIN")}>
                        <input
                          type="text"
                          dir="ltr"
                          value={settings.officePinFixedCode ?? "2026"}
                          onChange={(e) => setSettings({ ...settings, officePinFixedCode: e.target.value })}
                          placeholder="2026"
                          className={INPUT_CLS}
                        />
                      </PolicyField>
                    ) : (
                      <div>
                        <button
                          type="button"
                          onClick={handleRegenerateDailyPin}
                          className="w-full px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded text-xs cursor-pointer border border-zinc-900"
                        >
                          {t("🔄 توليد كود يومي جديد الآن", "🔄 Regenerate Today's PIN")}
                        </button>
                      </div>
                    )}

                    <label className="flex items-center gap-2 px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.officePinEnabled !== false}
                        onChange={(e) => setSettings({ ...settings, officePinEnabled: e.target.checked })}
                        className="h-4 w-4 accent-emerald-600 cursor-pointer"
                      />
                      <span className="text-[11px] font-bold">
                        {t("تفعيل الدخول بكود المكتب", "Enable Office PIN")}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Method 3: Trusted Office PC Authorization Code */}
                <div className="p-3 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-extrabold text-zinc-900 dark:text-white">
                        {t("٣. كود اعتماد أجهزة الكمبيوتر الثابتة بالشركة (Trusted Office PC Code)", "3. Trusted Office PC Setup Code")}
                      </span>
                      <p className="text-[10px] text-zinc-500">
                        {t(
                          "يُكتب هذا الكود السري لمرة واحدة فقط على أي كمبيوتر مكتبي ثابت داخل الشركة ليصبح معتمداً دائماً ولا يطلب GPS أو كود يومي أبداً.",
                          "Enter this setup code once on any stationary office desktop PC so it is permanently trusted and never asks for GPS or a daily PIN again.",
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                    <div className="sm:col-span-2">
                      <PolicyField label={t("كود اعتماد أجهزة المكتب (خاص بالأدمن فقط)", "Admin Office PC Setup Code")}>
                        <input
                          type="text"
                          dir="ltr"
                          value={settings.officeDeviceAuthSecret ?? "MFT-OFFICE-2026"}
                          onChange={(e) => setSettings({ ...settings, officeDeviceAuthSecret: e.target.value })}
                          placeholder="MFT-OFFICE-2026"
                          className={INPUT_CLS}
                        />
                      </PolicyField>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const nextSecret = `MFT-PC-${Math.floor(1000 + Math.random() * 9000)}`;
                        setSettings({ ...settings, officeDeviceAuthSecret: nextSecret });
                        toast.info(
                          t(
                            `تم تغيير كود اعتماد الأجهزة إلى ${nextSecret} — اضغط حفظ السياسات لإلغاء اعتماد أي أجهزة سابقة`,
                            `Changed PC setup code to ${nextSecret}`,
                          ),
                        );
                      }}
                      className="px-3 py-1.5 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-bold rounded text-[11px] cursor-pointer border border-zinc-400"
                    >
                      {t("🔒 تغيير الكود (إلغاء الأجهزة السابقة)", "🔒 Rotate Code (Revoke Old PCs)")}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-3 border-t-2 border-zinc-900 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setSettings(DEFAULT_HR_SETTINGS)}
                className="text-xs text-zinc-500 hover:text-red-600 underline font-mono cursor-pointer"
              >
                {t("إعادة الضبط للافتراضي", "Reset to Defaults")}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-950 dark:text-zinc-100 font-bold uppercase cursor-pointer"
                >
                  {t("إلغاء", "Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer disabled:opacity-50"
                >
                  {saving ? t("جارٍ الحفظ...", "Saving...") : t("حفظ السياسات ✓", "Save Policies ✓")}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
